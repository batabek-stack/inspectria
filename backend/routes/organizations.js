const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

function platformAdminOnly(req, res, next) {
  if (!db.isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: "Platform admin access required" });
  }
  next();
}

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
    ...counts,
    reportCount: reportCount.count,
    admins,
    users,
  };
}

router.get("/", authRequired, platformAdminOnly, async (_req, res, next) => {
  try {
    const organizations = await db.many(
      `
      SELECT
        id,
        name,
        plan,
        active,
        created_at
      FROM organizations
      ORDER BY id DESC
    `
    );

    res.json(await Promise.all(organizations.map(mapOrganization)));
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const {
      name,
      plan = "standard",
      adminEmail,
      adminUsername,
      adminPassword,
      adminName,
    } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanPlan = String(plan || "standard").trim() || "standard";

    if (!cleanName) {
      return res.status(400).json({ message: "Organization name is required" });
    }

    const result = await db.transaction(async (client) => {
      const orgResult = await client.query(
        `
        INSERT INTO organizations (name, plan, active)
        VALUES ($1, $2, TRUE)
        RETURNING id
      `,
        [cleanName, cleanPlan]
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
      SELECT id, name, plan, active, created_at
      FROM organizations
      WHERE id = $1
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

router.put("/:id", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const organizationId = Number(req.params.id);
    const { name, plan, active } = req.body || {};

    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
    }

    const existing = await db.one("SELECT * FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    if (!existing) return res.status(404).json({ message: "Organization not found" });

    const nextName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
    const nextPlan = typeof plan === "string" && plan.trim() ? plan.trim() : existing.plan;
    const nextActive = typeof active === "boolean" ? active : existing.active;

    const organization = await db.one(
      `
      UPDATE organizations
      SET name = $1, plan = $2, active = $3
      WHERE id = $4
      RETURNING id, name, plan, active, created_at
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

router.get("/:id/users", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const organizationId = Number(req.params.id);
    if (!organizationId) {
      return res.status(400).json({ message: "Invalid organization id" });
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

module.exports = router;
