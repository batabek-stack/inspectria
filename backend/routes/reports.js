const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();
const uploadRoot = path.join(__dirname, "..", "uploads");

function reportAccessWhere(user, params) {
  const where = [];

  if (!db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`r.organization_id = $${params.length}`);
  }

  if (user.role === "user") {
    params.push(user.id);
    where.push(`a.assigned_to_user_id = $${params.length}`);
  }

  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

async function getAssignmentForReport(assignmentId, user) {
  const params = [assignmentId];
  const where = ["a.id = $1"];

  if (!db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`a.organization_id = $${params.length}`);
  }

  if (user.role === "user") {
    params.push(user.id);
    where.push(`a.assigned_to_user_id = $${params.length}`);
  }

  return db.one(
    `
    SELECT a.id, a.organization_id, a.status
    FROM assignments a
    WHERE ${where.join(" AND ")}
  `,
    params
  );
}

function getUploadPath(filePath) {
  const normalized = String(filePath || "").replace(/^\/+/, "");
  if (!normalized.startsWith("uploads/")) return null;

  const absolutePath = path.resolve(__dirname, "..", normalized);
  const resolvedUploadRoot = path.resolve(uploadRoot);
  if (!absolutePath.startsWith(`${resolvedUploadRoot}${path.sep}`)) return null;

  return absolutePath;
}

function getImageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function getPhotoDataUrl(filePath) {
  if (String(filePath || "").startsWith("data:image/")) return filePath;

  const absolutePath = getUploadPath(filePath);
  if (!absolutePath) return "";

  const data = await fs.promises.readFile(absolutePath);
  return `data:${getImageMimeType(absolutePath)};base64,${data.toString("base64")}`;
}

router.get("/photo-data", authRequired, async (req, res, next) => {
  try {
    const filePath = String(req.query.path || "");
    if (!filePath) return res.status(400).json({ message: "Photo path is required" });

    const params = [filePath];
    const accessWhere = reportAccessWhere(req.user, params);
    const accessClause = accessWhere ? accessWhere.replace(/^WHERE\s+/, "AND ") : "";

    const photo = await db.one(
      `
      SELECT rp.file_path, rp.data_url
      FROM report_photos rp
      JOIN report_items ri ON rp.report_item_id = ri.id
      JOIN reports r ON ri.report_id = r.id
      JOIN assignments a ON r.assignment_id = a.id
      WHERE rp.file_path = $1
      ${accessClause}
      LIMIT 1
    `,
      params
    );

    if (!photo) return res.status(404).json({ message: "Photo not found" });

    if (photo.data_url) return res.json({ dataUrl: photo.data_url });

    const dataUrl = await getPhotoDataUrl(photo.file_path);
    if (!dataUrl) return res.status(400).json({ message: "Invalid photo path" });

    res.json({ dataUrl });
  } catch (error) {
    next(error);
  }
});

router.get("/", authRequired, async (req, res, next) => {
  try {
    const params = [];
    const reports = await db.many(
      `
      SELECT
        r.id,
        r.assignment_id,
        r.completed_by_user_id,
        r.completed_at,
        r.status,
        c.title AS "checklistTitle",
        c.image_path AS "checklistImagePath",
        u1.name AS "completedByName",
        u2.name AS "assignedToName",
        u3.name AS "assignedByName"
      FROM reports r
      JOIN assignments a ON r.assignment_id = a.id
      JOIN checklists c ON a.checklist_id = c.id
      JOIN users u1 ON r.completed_by_user_id = u1.id
      JOIN users u2 ON a.assigned_to_user_id = u2.id
      JOIN users u3 ON a.assigned_by_user_id = u3.id
      ${reportAccessWhere(req.user, params)}
      ORDER BY r.id DESC
    `,
      params
    );

    const result = await Promise.all(
      reports.map(async (report) => {
        const items = await db.many(
          `
          SELECT ri.*
          FROM report_items ri
          LEFT JOIN checklist_items ci ON ci.id = ri.checklist_item_id
          LEFT JOIN checklist_sections cs ON cs.id = ci.section_id
          WHERE ri.report_id = $1
          ORDER BY
            COALESCE(cs.sort_order, 999999),
            COALESCE(ci.sort_order, 999999),
            ri.id
        `,
          [report.id]
        );

        const itemsWithPhotos = await Promise.all(
          items.map(async (item) => ({
            ...item,
            photos: (
              await db.many(
                "SELECT file_path, data_url FROM report_photos WHERE report_item_id = $1 ORDER BY id",
                [item.id]
              )
            ).map((p) => p.data_url || p.file_path),
          }))
        );

        return {
          ...report,
          items: itemsWithPhotos,
        };
      })
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/unread-count", authRequired, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.json({ count: 0 });
    }

    const result = await db.one(
      `
      SELECT COUNT(*)::int AS count
      FROM report_notifications
      WHERE recipient_user_id = $1
        AND read_at IS NULL
    `,
      [req.user.id]
    );

    res.json({ count: Number(result?.count || 0) });
  } catch (error) {
    next(error);
  }
});

router.post("/mark-read", authRequired, async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      await db.query(
        `
        UPDATE report_notifications
        SET read_at = NOW()
        WHERE recipient_user_id = $1
          AND read_at IS NULL
      `,
        [req.user.id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, async (req, res, next) => {
  try {
    const { assignmentId, items = [] } = req.body || {};

    if (!assignmentId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "assignmentId and items are required",
      });
    }

    const assignment = await getAssignmentForReport(assignmentId, req.user);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const reportId = await db.transaction(async (client) => {
      const reportResult = await client.query(
        `
        INSERT INTO reports
          (organization_id, assignment_id, completed_by_user_id, completed_at, status)
        VALUES ($1, $2, $3, NOW(), 'Completed')
        RETURNING id
      `,
        [assignment.organization_id, assignmentId, req.user.id]
      );

      const nextReportId = reportResult.rows[0].id;

      for (const item of items) {
        const itemResult = await client.query(
          `
          INSERT INTO report_items
            (report_id, checklist_item_id, question, answer, answer_type, comment, section_title)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
          [
            nextReportId,
            item.itemId,
            item.question,
            item.answer,
            item.answerType || item.answer_type || "FORMAT1",
            item.comment || "",
            item.sectionTitle || "",
          ]
        );

        for (const photo of item.photos || []) {
          let photoDataUrl = "";
          try {
            photoDataUrl = await getPhotoDataUrl(photo);
          } catch {
            photoDataUrl = "";
          }

          await client.query(
            `
            INSERT INTO report_photos (report_item_id, file_path, data_url)
            VALUES ($1, $2, $3)
          `,
            [itemResult.rows[0].id, photo, photoDataUrl || null]
          );
        }
      }

      await client.query("UPDATE assignments SET status = 'completed' WHERE id = $1", [
        assignmentId,
      ]);

      await client.query(
        "DELETE FROM draft_reports WHERE assignment_id = $1 AND user_id = $2",
        [assignmentId, req.user.id]
      );

      await client.query(
        `
        INSERT INTO report_notifications (report_id, recipient_user_id, organization_id)
        SELECT $1, u.id, $2
        FROM users u
        WHERE u.organization_id = $2
          AND u.role = 'admin'
          AND u.active = TRUE
          AND u.approval_status = 'approved'
        ON CONFLICT (report_id, recipient_user_id) DO NOTHING
      `,
        [nextReportId, assignment.organization_id]
      );

      return nextReportId;
    });

    res.json({
      success: true,
      reportId,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id);

    if (!reportId) {
      return res.status(400).json({
        message: "Invalid report id",
      });
    }

    const params = [reportId];
    const where = ["r.id = $1"];

    if (!db.isPlatformAdmin(req.user)) {
      params.push(req.user.organizationId);
      where.push(`r.organization_id = $${params.length}`);
    }

    if (req.user.role === "user") {
      params.push(req.user.id);
      where.push(`r.completed_by_user_id = $${params.length}`);
    }

    const report = await db.one(
      `
      SELECT r.id, r.assignment_id
      FROM reports r
      WHERE ${where.join(" AND ")}
    `,
      params
    );

    if (!report) {
      return res.status(404).json({
        message: "Report not found",
      });
    }

    await db.transaction(async (client) => {
      const photoResult = await client.query(
        `
        SELECT rp.file_path
        FROM report_photos rp
        JOIN report_items ri ON rp.report_item_id = ri.id
        WHERE ri.report_id = $1
      `,
        [reportId]
      );

      for (const photo of photoResult.rows) {
        await client.query(
          `
          INSERT INTO upload_cleanup_queue (file_path, reason, delete_after)
          VALUES ($1, 'deleted_report', NOW() + INTERVAL '30 days')
          ON CONFLICT (file_path, reason)
          DO UPDATE SET
            delete_after = EXCLUDED.delete_after,
            processed_at = NULL
        `,
          [photo.file_path]
        );
      }

      await client.query("DELETE FROM reports WHERE id = $1", [reportId]);
      await client.query("UPDATE assignments SET status = 'assigned' WHERE id = $1", [
        report.assignment_id,
      ]);
    });

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
