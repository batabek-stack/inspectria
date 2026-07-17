const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const {
  isEmailConfigured,
  sendActionPlanEmail,
  sendActionPlanOverdueAdminEmail,
  sendActionPlanReminderEmail,
} = require("../services/emailService");

const router = express.Router();
const STATUSES = new Set(["Open", "In Progress", "Blocked", "Done"]);

function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanStatus(status) {
  const value = String(status || "Open").trim();
  return STATUSES.has(value) ? value : "Open";
}

function toActionPlan(row) {
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    organizationName: row.organizationName || "",
    item: row.item,
    action: row.action,
    remarks: row.remarks || "",
    dueDate: row.dueDate,
    status: row.status,
    responsibleParties: row.responsibleParties || [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listActionPlans(req) {
  const params = [];
  const where = [];

  if (db.isPlatformAdmin(req.user)) {
    const scopeIds = await db.getManagedOrganizationIds(req.user);
    if (scopeIds.length === 0) return [];
    params.push(scopeIds);
    where.push(`api.organization_id = ANY($${params.length}::int[])`);
  } else {
    params.push(req.user.organizationId);
    where.push(`api.organization_id = $${params.length}`);
  }

  if (req.user.role === "user") {
    params.push(cleanEmail(req.user.email || req.user.username));
    where.push(`EXISTS (
      SELECT 1
      FROM action_plan_responsible_parties rp
      WHERE rp.action_plan_item_id = api.id
        AND LOWER(rp.email) = $${params.length}
    )`);
  }

  const rows = await db.many(
    `
    SELECT
      api.id,
      api.organization_id AS "organizationId",
      o.name AS "organizationName",
      api.item,
      api.action,
      api.remarks,
      api.due_date::text AS "dueDate",
      api.status,
      api.created_at AS "createdAt",
      api.updated_at AS "updatedAt",
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', rp.id,
            'userId', rp.user_id,
            'email', rp.email,
            'name', u.name
          )
        ) FILTER (WHERE rp.id IS NOT NULL),
        '[]'
      ) AS "responsibleParties"
    FROM action_plan_items api
    JOIN organizations o ON o.id = api.organization_id
    LEFT JOIN action_plan_responsible_parties rp ON rp.action_plan_item_id = api.id
    LEFT JOIN users u ON u.id = rp.user_id
    WHERE ${where.join(" AND ")}
    GROUP BY api.id, o.name
    ORDER BY api.due_date ASC, api.id DESC
  `,
    params
  );

  return rows.map(toActionPlan);
}

router.get("/", authRequired, async (req, res, next) => {
  try {
    res.json(await listActionPlans(req));
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const organizationId = db.isPlatformAdmin(req.user)
      ? Number(req.body?.organizationId || req.user.organizationId)
      : Number(req.body?.organizationId || req.user.organizationId);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!organizationId || items.length === 0) {
      return res.status(400).json({ message: "organizationId and items are required" });
    }

    if (!(await db.userCanManageOrganization(req.user, organizationId))) {
      return res.status(403).json({ message: "Organization is outside your access scope" });
    }

    const organization = await db.one("SELECT id, name FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    const createdIds = await db.transaction(async (client) => {
      const ids = [];
      for (const rawItem of items) {
        const item = String(rawItem?.item || "").trim();
        const action = String(rawItem?.action || "").trim();
        const remarks = String(rawItem?.remarks || "").trim();
        const dueDate = String(rawItem?.dueDate || "").trim();
        const emails = Array.from(
          new Set((rawItem?.responsibleEmails || []).map(cleanEmail).filter(Boolean))
        );

        if (!item || !action || !dueDate || emails.length === 0) {
          throw Object.assign(
            new Error("Item, action, due date and at least one responsible email are required"),
            { statusCode: 400 }
          );
        }

        const invalidEmail = emails.find((email) => !isValidEmail(email));
        if (invalidEmail) {
          throw Object.assign(new Error(`Invalid email: ${invalidEmail}`), { statusCode: 400 });
        }

        const insertResult = await client.query(
          `
          INSERT INTO action_plan_items
            (organization_id, created_by_user_id, item, action, remarks, due_date, status)
          VALUES ($1, $2, $3, $4, $5, $6::date, $7)
          RETURNING id
        `,
          [organizationId, req.user.id, item, action, remarks, dueDate, cleanStatus(rawItem?.status)]
        );
        const actionPlanItemId = Number(insertResult.rows[0].id);
        ids.push(actionPlanItemId);

        for (const email of emails) {
          const user = await client.query(
            `
            SELECT id
            FROM users
            WHERE organization_id = $1
              AND LOWER(email) = $2
              AND active = TRUE
            LIMIT 1
          `,
            [organizationId, email]
          );
          await client.query(
            `
            INSERT INTO action_plan_responsible_parties
              (action_plan_item_id, user_id, email)
            VALUES ($1, $2, $3)
            ON CONFLICT (action_plan_item_id, email) DO NOTHING
          `,
            [actionPlanItemId, user.rows[0]?.id || null, email]
          );
        }
      }
      return ids;
    });

    const createdItems = (await listActionPlans(req)).filter((item) => createdIds.includes(item.id));
    const byEmail = new Map();
    createdItems.forEach((item) => {
      item.responsibleParties.forEach((party) => {
        const email = cleanEmail(party.email);
        if (!email) return;
        byEmail.set(email, [...(byEmail.get(email) || []), item]);
      });
    });

    let emailError = "";
    if (isEmailConfigured()) {
      await Promise.all(
        Array.from(byEmail.entries()).map(([to, assignedItems]) =>
          sendActionPlanEmail({
            to,
            organizationName: organization.name,
            items: assignedItems,
          }).catch((error) => {
            emailError = error instanceof Error ? error.message : "Action plan email failed";
          })
        )
      );
    }

    res.json({ success: true, items: createdItems, emailError: emailError || undefined });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const remarks = String(req.body?.remarks || "").trim();
    const status = cleanStatus(req.body?.status);

    const existing = await db.one(
      `
      SELECT id, organization_id
      FROM action_plan_items
      WHERE id = $1
    `,
      [id]
    );
    if (!existing) return res.status(404).json({ message: "Action plan item not found" });

    const canAdminEdit =
      (req.user.role === "admin" || req.user.role === "platform_admin") &&
      (await db.userCanManageOrganization(req.user, existing.organization_id));
    const canAssignedUserEdit =
      req.user.role === "user" &&
      existing.organization_id === req.user.organizationId &&
      Boolean(
        await db.one(
          `
          SELECT id
          FROM action_plan_responsible_parties
          WHERE action_plan_item_id = $1
            AND LOWER(email) = $2
          LIMIT 1
        `,
          [id, cleanEmail(req.user.email || req.user.username)]
        )
      );

    if (!canAdminEdit && !canAssignedUserEdit) {
      return res.status(403).json({ message: "You cannot update this action plan item" });
    }

    await db.query(
      `
      UPDATE action_plan_items
      SET remarks = $1, status = $2, updated_at = NOW()
      WHERE id = $3
    `,
      [remarks, status, id]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const organizationId = db.isPlatformAdmin(req.user)
      ? Number(req.query.organizationId || req.user.organizationId)
      : Number(req.query.organizationId || req.user.organizationId);

    if (!organizationId) {
      return res.status(400).json({ message: "organizationId is required" });
    }

    if (!(await db.userCanManageOrganization(req.user, organizationId))) {
      return res.status(403).json({ message: "Organization is outside your access scope" });
    }

    await db.query("DELETE FROM action_plan_items WHERE organization_id = $1", [organizationId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.one(
      "SELECT id, organization_id FROM action_plan_items WHERE id = $1",
      [id]
    );
    if (!existing) return res.status(404).json({ message: "Action plan item not found" });
    if (!(await db.userCanManageOrganization(req.user, existing.organization_id))) {
      return res.status(403).json({ message: "Organization is outside your access scope" });
    }
    await db.query("DELETE FROM action_plan_items WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

async function runActionPlanNotifications() {
  if (!isEmailConfigured()) return;

  const reminderRows = await db.many(`
    SELECT
      api.id,
      api.organization_id AS "organizationId",
      o.name AS "organizationName",
      api.item,
      api.action,
      api.remarks,
      api.due_date::text AS "dueDate",
      api.status,
      rp.email
    FROM action_plan_items api
    JOIN organizations o ON o.id = api.organization_id
    JOIN action_plan_responsible_parties rp ON rp.action_plan_item_id = api.id
    WHERE api.status != 'Done'
      AND api.reminder_sent_at IS NULL
      AND api.due_date = CURRENT_DATE + INTERVAL '1 day'
  `);

  const reminderGroups = new Map();
  reminderRows.forEach((row) => {
    const key = `${row.email}|${row.organizationName}`;
    reminderGroups.set(key, [...(reminderGroups.get(key) || []), row]);
  });
  for (const [key, items] of reminderGroups.entries()) {
    const [to, organizationName] = key.split("|");
    await sendActionPlanReminderEmail({ to, organizationName, items });
    await db.query(
      "UPDATE action_plan_items SET reminder_sent_at = NOW() WHERE id = ANY($1::int[])",
      [items.map((item) => Number(item.id))]
    );
  }

  const overdueRows = await db.many(`
    SELECT
      api.id,
      api.organization_id AS "organizationId",
      o.name AS "organizationName",
      api.item,
      api.action,
      api.remarks,
      api.due_date::text AS "dueDate",
      api.status
    FROM action_plan_items api
    JOIN organizations o ON o.id = api.organization_id
    WHERE api.status != 'Done'
      AND api.overdue_admin_sent_at IS NULL
      AND api.due_date < CURRENT_DATE
  `);

  const overdueByOrg = new Map();
  overdueRows.forEach((row) => {
    overdueByOrg.set(row.organizationId, [...(overdueByOrg.get(row.organizationId) || []), row]);
  });
  for (const [organizationId, items] of overdueByOrg.entries()) {
    const admins = await db.many(
      `
      SELECT email
      FROM users
      WHERE organization_id = $1
        AND role = 'admin'
        AND active = TRUE
        AND email != ''
    `,
      [organizationId]
    );
    await Promise.all(
      admins.map((admin) =>
        sendActionPlanOverdueAdminEmail({
          to: admin.email,
          organizationName: items[0]?.organizationName || "Organization",
          items,
        })
      )
    );
    await db.query(
      "UPDATE action_plan_items SET overdue_admin_sent_at = NOW() WHERE id = ANY($1::int[])",
      [items.map((item) => Number(item.id))]
    );
  }
}

module.exports = router;
module.exports.runActionPlanNotifications = runActionPlanNotifications;
