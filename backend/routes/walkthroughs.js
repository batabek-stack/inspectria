const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

function userCanSeeWalkthrough(user, row) {
  if (db.isPlatformAdmin(user)) return true;
  if (user.role === "admin") return Number(row.organization_id) === Number(user.organizationId);
  return Number(row.created_by_user_id) === Number(user.id);
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) return [];

  return sections
    .map((section) => ({
      title: String(section?.title || "").trim(),
      items: Array.isArray(section?.items) ? section.items : [],
    }))
    .filter((section) => section.title)
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => ({
          comment: String(item?.comment || "").trim(),
          severity: String(item?.severity || "").trim(),
          photos: Array.isArray(item?.photos)
            ? item.photos.map((photo) => String(photo || "").trim()).filter(Boolean)
            : [],
        }))
        .filter((item) => item.comment || item.photos.length > 0),
    }));
}

async function getWalkthroughRow(id) {
  return db.one(
    `
    SELECT
      w.*,
      u.name AS "createdByName",
      o.name AS "organizationName"
    FROM walkthroughs w
    JOIN users u ON u.id = w.created_by_user_id
    LEFT JOIN organizations o ON o.id = w.organization_id
    WHERE w.id = $1
  `,
    [id]
  );
}

async function hydrateWalkthrough(row) {
  const sections = await db.many(
    `
    SELECT id, walkthrough_id, title, sort_order
    FROM walkthrough_sections
    WHERE walkthrough_id = $1
    ORDER BY sort_order, id
  `,
    [row.id]
  );

  const hydratedSections = await Promise.all(
    sections.map(async (section) => {
      const items = await db.many(
        `
        SELECT id, section_id, comment, severity, sort_order
        FROM walkthrough_items
        WHERE section_id = $1
        ORDER BY sort_order, id
      `,
        [section.id]
      );

      const hydratedItems = await Promise.all(
        items.map(async (item) => ({
          ...item,
          photos: (
            await db.many(
              `SELECT file_path FROM walkthrough_photos WHERE item_id = $1 ORDER BY id`,
              [item.id]
            )
          ).map((photo) => photo.file_path),
        }))
      );

      return {
        ...section,
        items: hydratedItems,
      };
    })
  );

  return {
    ...row,
    sections: hydratedSections,
  };
}

async function replaceSections(client, walkthroughId, sections) {
  await client.query("DELETE FROM walkthrough_sections WHERE walkthrough_id = $1", [walkthroughId]);

  for (const [sectionIndex, section] of sections.entries()) {
    const sectionResult = await client.query(
      `
      INSERT INTO walkthrough_sections (walkthrough_id, title, sort_order)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [walkthroughId, section.title, sectionIndex + 1]
    );

    const sectionId = sectionResult.rows[0].id;

    for (const [itemIndex, item] of section.items.entries()) {
      const itemResult = await client.query(
        `
        INSERT INTO walkthrough_items (section_id, comment, severity, sort_order)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
        [sectionId, item.comment || "", item.severity || "", itemIndex + 1]
      );

      for (const photo of item.photos || []) {
        await client.query(
          `INSERT INTO walkthrough_photos (item_id, file_path) VALUES ($1, $2)`,
          [itemResult.rows[0].id, photo]
        );
      }
    }
  }
}

router.get("/", authRequired, async (req, res, next) => {
  try {
    const params = [];
    const where = [];

    if (!db.isPlatformAdmin(req.user)) {
      params.push(req.user.organizationId);
      where.push(`w.organization_id = $${params.length}`);
    }

    if (req.user.role === "user") {
      params.push(req.user.id);
      where.push(`w.created_by_user_id = $${params.length}`);
    }

    const rows = await db.many(
      `
      SELECT
        w.*,
        u.name AS "createdByName",
        o.name AS "organizationName"
      FROM walkthroughs w
      JOIN users u ON u.id = w.created_by_user_id
      LEFT JOIN organizations o ON o.id = w.organization_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY w.updated_at DESC, w.id DESC
    `,
      params
    );

    res.json(await Promise.all(rows.map(hydrateWalkthrough)));
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, async (req, res, next) => {
  try {
    const { title, location = "", sections = [], status = "draft" } = req.body || {};
    const cleanTitle = String(title || "").trim();
    const cleanSections = normalizeSections(sections);
    const nextStatus = status === "completed" ? "completed" : "draft";

    if (!cleanTitle) {
      return res.status(400).json({ message: "Walkthrough title is required" });
    }

    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Organization is required" });
    }

    const walkthroughId = await db.transaction(async (client) => {
      const result = await client.query(
        `
        INSERT INTO walkthroughs
          (organization_id, created_by_user_id, title, location, status, updated_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), CASE WHEN $5 = 'completed' THEN NOW() ELSE NULL END)
        RETURNING id
      `,
        [req.user.organizationId, req.user.id, cleanTitle, String(location || "").trim(), nextStatus]
      );

      await replaceSections(client, result.rows[0].id, cleanSections);
      return result.rows[0].id;
    });

    const row = await getWalkthroughRow(walkthroughId);
    res.json({ success: true, walkthrough: await hydrateWalkthrough(row) });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", authRequired, async (req, res, next) => {
  try {
    const walkthroughId = Number(req.params.id);
    const { title, location = "", sections = [], status } = req.body || {};
    const cleanTitle = String(title || "").trim();
    const cleanSections = normalizeSections(sections);

    if (!walkthroughId) return res.status(400).json({ message: "Invalid walkthrough id" });
    if (!cleanTitle) return res.status(400).json({ message: "Walkthrough title is required" });

    const existing = await db.one("SELECT * FROM walkthroughs WHERE id = $1", [walkthroughId]);
    if (!existing || !userCanSeeWalkthrough(req.user, existing)) {
      return res.status(404).json({ message: "Walkthrough not found" });
    }

    const nextStatus = status === "completed" ? "completed" : existing.status;

    await db.transaction(async (client) => {
      await client.query(
        `
        UPDATE walkthroughs
        SET title = $1,
            location = $2,
            status = $3,
            updated_at = NOW(),
            completed_at = CASE
              WHEN $3 = 'completed' AND completed_at IS NULL THEN NOW()
              WHEN $3 = 'draft' THEN NULL
              ELSE completed_at
            END
        WHERE id = $4
      `,
        [cleanTitle, String(location || "").trim(), nextStatus, walkthroughId]
      );

      await replaceSections(client, walkthroughId, cleanSections);
    });

    const row = await getWalkthroughRow(walkthroughId);
    res.json({ success: true, walkthrough: await hydrateWalkthrough(row) });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/complete", authRequired, async (req, res, next) => {
  try {
    const walkthroughId = Number(req.params.id);
    if (!walkthroughId) return res.status(400).json({ message: "Invalid walkthrough id" });

    const existing = await db.one("SELECT * FROM walkthroughs WHERE id = $1", [walkthroughId]);
    if (!existing || !userCanSeeWalkthrough(req.user, existing)) {
      return res.status(404).json({ message: "Walkthrough not found" });
    }

    await db.query(
      `
      UPDATE walkthroughs
      SET status = 'completed', updated_at = NOW(), completed_at = COALESCE(completed_at, NOW())
      WHERE id = $1
    `,
      [walkthroughId]
    );

    const row = await getWalkthroughRow(walkthroughId);
    res.json({ success: true, walkthrough: await hydrateWalkthrough(row) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, async (req, res, next) => {
  try {
    const walkthroughId = Number(req.params.id);
    if (!walkthroughId) return res.status(400).json({ message: "Invalid walkthrough id" });

    const existing = await db.one("SELECT * FROM walkthroughs WHERE id = $1", [walkthroughId]);
    if (!existing || !userCanSeeWalkthrough(req.user, existing)) {
      return res.status(404).json({ message: "Walkthrough not found" });
    }

    await db.transaction(async (client) => {
      const photoResult = await client.query(
        `
        SELECT wp.file_path
        FROM walkthrough_photos wp
        JOIN walkthrough_items wi ON wp.item_id = wi.id
        JOIN walkthrough_sections ws ON wi.section_id = ws.id
        WHERE ws.walkthrough_id = $1
      `,
        [walkthroughId]
      );

      for (const photo of photoResult.rows) {
        await client.query(
          `
          INSERT INTO upload_cleanup_queue (file_path, reason, delete_after)
          VALUES ($1, 'deleted_walkthrough', NOW() + INTERVAL '30 days')
          ON CONFLICT (file_path, reason)
          DO UPDATE SET
            delete_after = EXCLUDED.delete_after,
            processed_at = NULL
        `,
          [photo.file_path]
        );
      }

      await client.query("DELETE FROM walkthroughs WHERE id = $1", [walkthroughId]);
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
