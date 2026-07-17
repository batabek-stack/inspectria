const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

async function mapOrganization(org) {
  const counts = await db.one(
    `
    SELECT
      COUNT(*)::int AS "userCount",
      COUNT(*) FILTER (WHERE role = 'admin')::int AS "adminCount",
      COUNT(*) FILTER (WHERE role = 'user')::int AS "inspectorCount",
      COUNT(*) FILTER (WHERE approval_status = 'pending')::int AS "pendingUserCount"
    FROM users
    WHERE organization_id = $1
  `,
    [org.id]
  );

  const reportCount = await db.one(
    "SELECT COUNT(*)::int AS count FROM reports WHERE organization_id = $1",
    [org.id]
  );

  const admins = await db.many(
    `
    SELECT
      id,
      organization_id AS "organizationId",
      email,
      username,
      name,
      role,
      active,
      approval_status AS "approvalStatus",
      last_login_at AS "lastLoginAt",
      created_at
    FROM users
    WHERE organization_id = $1 AND role = 'admin'
    ORDER BY id
  `,
    [org.id]
  );

  const users = await db.many(
    `
    SELECT
      id,
      organization_id AS "organizationId",
      email,
      username,
      name,
      role,
      active,
      approval_status AS "approvalStatus",
      last_login_at AS "lastLoginAt",
      created_at
    FROM users
    WHERE organization_id = $1
      AND role IN ('admin', 'user')
    ORDER BY
      CASE role WHEN 'admin' THEN 0 ELSE 1 END,
      CASE approval_status WHEN 'pending' THEN 0 ELSE 1 END,
      id
  `,
    [org.id]
  );

  return {
    ...org,
    parentOrganizationId: org.parentOrganizationId || null,
    parentOrganizationName: org.parentOrganizationName || null,
    ...counts,
    reportCount: reportCount.count,
    admins,
    users,
  };
}

async function userCanCreateSubOrganization(user) {
  if (db.isPlatformAdmin(user)) return true;
  if (!user?.organizationId) return false;

  const organization = await db.one(
    `
    SELECT
      o.id,
      o.parent_organization_id,
      o.plan,
      p.code AS subscription_plan_code
    FROM organizations o
    LEFT JOIN subscriptions s
      ON s.organization_id = o.id
      AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN billing_plans p ON p.id = s.billing_plan_id
    WHERE o.id = $1
    ORDER BY s.id DESC NULLS LAST
    LIMIT 1
  `,
    [user.organizationId]
  );

  const planCode = String(organization?.subscription_plan_code || organization?.plan || "").toLowerCase();

  return (
    Boolean(organization) &&
    !organization.parent_organization_id &&
    planCode === "enterprise"
  );
}

router.get("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const scopeIds = await db.getManagedOrganizationIds(req.user);
    if (scopeIds.length === 0) return res.json([]);

    const organizations = await db.many(
      `
      SELECT
        o.id,
        o.parent_organization_id AS "parentOrganizationId",
        parent.name AS "parentOrganizationName",
        o.name,
        o.plan,
        o.active,
        o.created_at
      FROM organizations
      o
      LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
      WHERE o.id = ANY($1::int[])
      ORDER BY
        COALESCE(o.parent_organization_id, 0),
        o.id DESC
    `,
      [scopeIds]
    );

    res.json(await Promise.all(organizations.map(mapOrganization)));
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const {
      name,
      plan = "standard",
      parentOrganizationId,
      adminEmail,
      adminUsername,
      adminPassword,
      adminName,
    } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanPlan = db.isPlatformAdmin(req.user)
      ? String(plan || "standard").trim() || "standard"
      : "standard";
    const cleanParentOrganizationId = db.isPlatformAdmin(req.user)
      ? parentOrganizationId
        ? Number(parentOrganizationId)
        : null
      : parentOrganizationId
        ? Number(parentOrganizationId)
        : Number(req.user.organizationId);

    if (!cleanName) {
      return res.status(400).json({ message: "Organization name is required" });
    }

    if (!db.isPlatformAdmin(req.user) && !(await userCanCreateSubOrganization(req.user))) {
      return res.status(403).json({
        message: "Only enterprise tenant admins can create sub-organizations",
      });
    }

    if (
      !db.isPlatformAdmin(req.user) &&
      Number(cleanParentOrganizationId) !== Number(req.user.organizationId)
    ) {
      return res.status(403).json({
        message: "Sub-organizations can only be created directly under your enterprise tenant",
      });
    }

    if (
      cleanParentOrganizationId !== null &&
      (!Number.isInteger(cleanParentOrganizationId) || cleanParentOrganizationId <= 0)
    ) {
      return res.status(400).json({ message: "Invalid parent organization id" });
    }

    if (!db.isPlatformAdmin(req.user) && !cleanParentOrganizationId) {
      return res.status(400).json({ message: "Parent organization is required" });
    }

    if (cleanParentOrganizationId) {
      const canUseParent = await db.userCanManageOrganization(req.user, cleanParentOrganizationId);
      if (!canUseParent) {
        return res.status(403).json({ message: "Parent organization is outside your access scope" });
      }
    }

    const result = await db.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1))::bigint)", [
        cleanName,
      ]);

      const existingOrganization = await client.query(
        `
        SELECT id
        FROM organizations
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
        [cleanName]
      );

      if (existingOrganization.rows[0]) {
        throw Object.assign(new Error("Organization name already exists"), {
          statusCode: 400,
        });
      }

      const orgResult = await client.query(
        `
        INSERT INTO organizations (parent_organization_id, name, plan, active)
        VALUES ($1, $2, $3, TRUE)
        RETURNING id
      `,
        [cleanParentOrganizationId, cleanName, cleanPlan]
      );

      const organizationId = orgResult.rows[0].id;

      if (adminEmail || adminUsername || adminPassword || adminName) {
        const cleanAdminEmail = String(adminEmail || "").trim().toLowerCase();
        if (!cleanAdminEmail || !adminUsername || !adminPassword || !adminName) {
          throw Object.assign(new Error("Admin email, username, password and name are required"), {
            statusCode: 400,
          });
        }

        if (!cleanAdminEmail.includes("@")) {
          throw Object.assign(new Error("A valid admin email address is required"), {
            statusCode: 400,
          });
        }

        const passwordHash = await bcrypt.hash(String(adminPassword), 10);
        await client.query(
          `
          INSERT INTO users
            (organization_id, email, username, password_hash, name, role, active, approval_status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'admin', TRUE, 'approved', NOW())
        `,
          [
            organizationId,
            cleanAdminEmail,
            String(adminUsername).trim(),
            passwordHash,
            String(adminName).trim(),
          ]
        );
      }

      return organizationId;
    });

    const organization = await db.one(
      `
      SELECT
        o.id,
        o.parent_organization_id AS "parentOrganizationId",
        parent.name AS "parentOrganizationName",
        o.name,
        o.plan,
        o.active,
        o.created_at
      FROM organizations o
      LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
      WHERE o.id = $1
    `,
      [result]
    );

    res.json({
      success: true,
      organization: await mapOrganization(organization),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error.code === "23505") {
      return res.status(400).json({ message: "Organization or username already exists" });
    }

    next(error);
  }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const organizationId = Number(req.params.id);
    const { name, plan, active } = req.body || {};

    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    if (!(await db.userCanManageOrganization(req.user, organizationId))) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const existing = await db.one("SELECT * FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    if (!existing) return res.status(404).json({ message: "Organization not found" });

    const nextName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
    const nextPlan =
      db.isPlatformAdmin(req.user) && typeof plan === "string" && plan.trim()
        ? plan.trim()
        : existing.plan;
    const nextActive =
      db.isPlatformAdmin(req.user) && typeof active === "boolean"
        ? active
        : existing.active;

    const duplicateOrganization = await db.one(
      `
      SELECT id
      FROM organizations
      WHERE id != $1
        AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
      [organizationId, nextName]
    );

    if (duplicateOrganization) {
      return res.status(400).json({ message: "Organization name already exists" });
    }

    if (
      !db.isPlatformAdmin(req.user) &&
      Number(req.user.organizationId) === organizationId &&
      nextActive === false
    ) {
      return res.status(400).json({ message: "You cannot deactivate your own organization" });
    }

    const organization = await db.one(
      `
      UPDATE organizations
      SET name = $1, plan = $2, active = $3
      WHERE id = $4
      RETURNING
        id,
        parent_organization_id AS "parentOrganizationId",
        name,
        plan,
        active,
        created_at
    `,
      [nextName, nextPlan, nextActive, organizationId]
    );

    if (!nextActive) {
      await db.query(
        `
        DELETE FROM sessions
        WHERE user_id IN (
          SELECT id FROM users WHERE organization_id = $1
        )
      `,
        [organizationId]
      );
    }

    res.json({
      success: true,
      organization: await mapOrganization(organization),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ message: "Organization name already exists" });
    }

    next(error);
  }
});

router.get("/:id/users", authRequired, adminOnly, async (req, res, next) => {
  try {
    const organizationId = Number(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    if (!(await db.userCanManageOrganization(req.user, organizationId))) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const users = await db.many(
      `
      SELECT
        id,
        organization_id AS "organizationId",
        email,
        username,
        name,
        role,
        active,
        approval_status AS "approvalStatus",
        last_login_at AS "lastLoginAt",
        created_at
      FROM users
      WHERE organization_id = $1
      ORDER BY
        CASE approval_status WHEN 'pending' THEN 0 ELSE 1 END,
        id
    `,
      [organizationId]
    );

    res.json(users);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const organizationId = Number(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    if (req.user.organizationId && Number(req.user.organizationId) === organizationId) {
      return res.status(400).json({
        message: "You cannot delete the organization attached to your own account",
      });
    }

    if (!(await db.userCanManageOrganization(req.user, organizationId))) {
      return res.status(404).json({ message: "Organization not found" });
    }

    const existing = await db.one("SELECT id, name FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    if (!existing) return res.status(404).json({ message: "Organization not found" });

    await db.transaction(async (client) => {
      await client.query(
        `
        DELETE FROM report_photos
        WHERE report_item_id IN (
          SELECT ri.id
          FROM report_items ri
          JOIN reports r ON r.id = ri.report_id
          WHERE r.organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query(
        `
        DELETE FROM report_items
        WHERE report_id IN (
          SELECT id FROM reports WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query("DELETE FROM reports WHERE organization_id = $1", [
        organizationId,
      ]);
      await client.query("DELETE FROM draft_reports WHERE organization_id = $1", [
        organizationId,
      ]);
      await client.query("DELETE FROM assignments WHERE organization_id = $1", [
        organizationId,
      ]);

      await client.query(
        `
        DELETE FROM checklist_items
        WHERE checklist_id IN (
          SELECT id FROM checklists WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query(
        `
        DELETE FROM checklist_sections
        WHERE checklist_id IN (
          SELECT id FROM checklists WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query("DELETE FROM checklists WHERE organization_id = $1", [
        organizationId,
      ]);

      await client.query(
        `
        DELETE FROM walkthrough_photos
        WHERE item_id IN (
          SELECT wi.id
          FROM walkthrough_items wi
          JOIN walkthrough_sections ws ON ws.id = wi.section_id
          JOIN walkthroughs w ON w.id = ws.walkthrough_id
          WHERE w.organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query(
        `
        DELETE FROM walkthrough_items
        WHERE section_id IN (
          SELECT ws.id
          FROM walkthrough_sections ws
          JOIN walkthroughs w ON w.id = ws.walkthrough_id
          WHERE w.organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query(
        `
        DELETE FROM walkthrough_sections
        WHERE walkthrough_id IN (
          SELECT id FROM walkthroughs WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query("DELETE FROM walkthroughs WHERE organization_id = $1", [
        organizationId,
      ]);

      await client.query("DELETE FROM subscriptions WHERE organization_id = $1", [
        organizationId,
      ]);
      await client.query(
        "DELETE FROM iyzico_checkout_sessions WHERE organization_id = $1",
        [organizationId]
      );
      await client.query("DELETE FROM email_logs WHERE organization_id = $1", [
        organizationId,
      ]);

      await client.query(
        `
        DELETE FROM password_reset_tokens
        WHERE user_id IN (
          SELECT id FROM users WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query(
        `
        DELETE FROM sessions
        WHERE user_id IN (
          SELECT id FROM users WHERE organization_id = $1
        )
      `,
        [organizationId]
      );

      await client.query("DELETE FROM users WHERE organization_id = $1", [
        organizationId,
      ]);
      await client.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    });

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
