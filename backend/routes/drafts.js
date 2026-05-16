const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

async function getAssignmentForUser(assignmentId, user) {
  const params = [assignmentId];
  const where = ["id = $1"];

  if (!db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`organization_id = $${params.length}`);
  }

  if (user.role === "user") {
    params.push(user.id);
    where.push(`assigned_to_user_id = $${params.length}`);
  }

  return db.one(
    `
    SELECT id, organization_id, status
    FROM assignments
    WHERE ${where.join(" AND ")}
  `,
    params
  );
}

router.get("/:assignmentId", authRequired, async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.assignmentId);

    if (!assignmentId) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }

    const assignment = await getAssignmentForUser(assignmentId, req.user);

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const draft = await db.one(
      `
      SELECT assignment_id, user_id, form_json, updated_at
      FROM draft_reports
      WHERE assignment_id = $1 AND user_id = $2 AND organization_id = $3
    `,
      [assignmentId, req.user.id, assignment.organization_id]
    );

    if (!draft) {
      return res.json({ draft: null });
    }

    let form = {};

    try {
      form = JSON.parse(draft.form_json || "{}");
    } catch {
      form = {};
    }

    return res.json({
      draft: {
        assignmentId: draft.assignment_id,
        userId: draft.user_id,
        form,
        updatedAt: draft.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:assignmentId", authRequired, async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.assignmentId);
    const { form = {} } = req.body || {};

    if (!assignmentId) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }

    if (!form || typeof form !== "object" || Array.isArray(form)) {
      return res.status(400).json({ message: "form must be an object" });
    }

    const assignment = await getAssignmentForUser(assignmentId, req.user);

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    if (assignment.status !== "assigned") {
      return res.status(400).json({ message: "Only assigned checklists can be saved" });
    }

    const updatedAt = new Date().toISOString();

    await db.query(
      `
      INSERT INTO draft_reports
        (organization_id, assignment_id, user_id, form_json, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (assignment_id, user_id)
      DO UPDATE SET
        form_json = EXCLUDED.form_json,
        updated_at = EXCLUDED.updated_at
    `,
      [assignment.organization_id, assignmentId, req.user.id, JSON.stringify(form), updatedAt]
    );

    return res.json({
      success: true,
      updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:assignmentId", authRequired, async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.assignmentId);

    if (!assignmentId) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }

    const assignment = await getAssignmentForUser(assignmentId, req.user);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    await db.query(
      `
      DELETE FROM draft_reports
      WHERE assignment_id = $1 AND user_id = $2 AND organization_id = $3
    `,
      [assignmentId, req.user.id, assignment.organization_id]
    );

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
