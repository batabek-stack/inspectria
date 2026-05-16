const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

router.get("/", authRequired, async (req, res, next) => {
  try {
    const params = [];
    const where = [];

    if (!db.isPlatformAdmin(req.user)) {
      params.push(req.user.organizationId);
      where.push(`a.organization_id = $${params.length}`);
    }

    if (req.user.role === "user") {
      params.push(req.user.id);
      where.push(`a.assigned_to_user_id = $${params.length}`);
    }

    const assignments = await db.many(
      `
      SELECT
        a.id,
        a.checklist_id,
        a.assigned_to_user_id,
        a.assigned_by_user_id,
        a.assigned_at,
        a.status,
        c.title AS "checklistTitle",
        c.image_path AS "checklistImagePath",
        u1.name AS "assignedToName",
        u2.name AS "assignedByName"
      FROM assignments a
      JOIN checklists c ON a.checklist_id = c.id
      JOIN users u1 ON a.assigned_to_user_id = u1.id
      JOIN users u2 ON a.assigned_by_user_id = u2.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.id DESC
    `,
      params
    );

    res.json(assignments);
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { checklistId, assignedToUserId } = req.body || {};
    if (!checklistId || !assignedToUserId) {
      return res.status(400).json({ message: "checklistId and assignedToUserId required" });
    }

    const orgId = req.user.organizationId;
    if (!orgId && !db.isPlatformAdmin(req.user)) {
      return res.status(400).json({ message: "Organization is required" });
    }

    const checklist = await db.one(
      `
      SELECT id, organization_id
      FROM checklists
      WHERE id = $1
        ${db.isPlatformAdmin(req.user) ? "" : "AND organization_id = $2"}
    `,
      db.isPlatformAdmin(req.user) ? [checklistId] : [checklistId, orgId]
    );

    if (!checklist) return res.status(404).json({ message: "Checklist not found" });

    const assignedUser = await db.one(
      `
      SELECT id
      FROM users
      WHERE id = $1
        AND organization_id = $2
        AND role = 'user'
        AND active = TRUE
    `,
      [assignedToUserId, checklist.organization_id]
    );

    if (!assignedUser) {
      return res.status(400).json({ message: "Assigned user must belong to this organization" });
    }

    const result = await db.one(
      `
      INSERT INTO assignments
        (organization_id, checklist_id, assigned_to_user_id, assigned_by_user_id, assigned_at, status)
      VALUES ($1, $2, $3, $4, NOW(), 'assigned')
      RETURNING id
    `,
      [checklist.organization_id, checklistId, assignedToUserId, req.user.id]
    );

    res.json({ success: true, assignmentId: result.id });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
