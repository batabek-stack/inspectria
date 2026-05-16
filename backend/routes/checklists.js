const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

const ANSWER_TYPES = new Set(["FORMAT1", "DATE", "TEXT", "MULTIPLE_CHOICE", "RADIO_BUTTON"]);

function normalizeChecklistItem(item) {
  const question = String(item?.question || "").trim();
  const answerType = ANSWER_TYPES.has(item?.answerType)
    ? item.answerType
    : ANSWER_TYPES.has(item?.answer_type)
      ? item.answer_type
      : "FORMAT1";
  const options = Array.isArray(item?.options)
    ? item.options.map((option) => String(option || "").trim()).filter(Boolean)
    : [];

  return {
    question,
    answerType,
    options: ["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(answerType) ? options : [],
  };
}

function mapDbItem(item) {
  let options = [];
  try {
    options = item.options_json ? JSON.parse(item.options_json) : [];
  } catch {
    options = [];
  }

  return {
    ...item,
    answerType: item.answer_type || "FORMAT1",
    options,
  };
}

function normalizeSections(sections) {
  return sections
    .map((section) => ({
      title: String(section.title || "").trim(),
      items: Array.isArray(section.items) ? section.items : [],
    }))
    .filter((section) => section.title && section.items.length > 0);
}

async function getChecklistForUser(checklistId, req) {
  return db.one(
    `
    SELECT id, organization_id, title
    FROM checklists
    WHERE id = $1
      ${db.isPlatformAdmin(req.user) ? "" : "AND organization_id = $2"}
  `,
    db.isPlatformAdmin(req.user) ? [checklistId] : [checklistId, req.user.organizationId]
  );
}

router.get("/", authRequired, async (req, res, next) => {
  try {
    const checklists = await db.many(
      `
      SELECT *
      FROM checklists
      ${db.isPlatformAdmin(req.user) ? "" : "WHERE organization_id = $1"}
      ORDER BY id DESC
    `,
      db.isPlatformAdmin(req.user) ? [] : [req.user.organizationId]
    );

    const result = await Promise.all(
      checklists.map(async (checklist) => {
        const sections = await db.many(
          `
          SELECT *
          FROM checklist_sections
          WHERE checklist_id = $1
          ORDER BY sort_order
        `,
          [checklist.id]
        );

        const sectionsWithItems = await Promise.all(
          sections.map(async (section) => ({
            ...section,
            items: (
              await db.many(
                `
                SELECT *
                FROM checklist_items
                WHERE checklist_id = $1 AND section_id = $2
                ORDER BY sort_order
              `,
                [checklist.id, section.id]
              )
            ).map(mapDbItem),
          }))
        );

        return {
          ...checklist,
          sections: sectionsWithItems,
        };
      })
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { title, imagePath = "", sections = [], organizationId } = req.body || {};
    const targetOrganizationId = db.isPlatformAdmin(req.user)
      ? Number(organizationId || req.user.organizationId)
      : req.user.organizationId;

    if (!title || !Array.isArray(sections) || sections.length === 0 || !targetOrganizationId) {
      return res.status(400).json({
        message: "Title, organization and sections are required",
      });
    }

    const validSections = normalizeSections(sections);

    if (validSections.length === 0) {
      return res.status(400).json({
        message: "At least one valid section with questions is required",
      });
    }

    const checklistId = await db.transaction(async (client) => {
      const checklistResult = await client.query(
        `
        INSERT INTO checklists (organization_id, title, image_path, created_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id
      `,
        [targetOrganizationId, String(title).trim(), String(imagePath || "").trim()]
      );

      const nextChecklistId = checklistResult.rows[0].id;

      for (const [sectionIndex, section] of validSections.entries()) {
        const sectionResult = await client.query(
          `
          INSERT INTO checklist_sections (checklist_id, title, sort_order)
          VALUES ($1, $2, $3)
          RETURNING id
        `,
          [nextChecklistId, section.title, sectionIndex + 1]
        );

        const sectionId = sectionResult.rows[0].id;

        for (const [itemIndex, item] of section.items
          .map(normalizeChecklistItem)
          .filter((candidate) => candidate.question)
          .entries()) {
          await client.query(
            `
            INSERT INTO checklist_items
              (checklist_id, section_id, question, answer_type, options_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
            [
              nextChecklistId,
              sectionId,
              item.question,
              item.answerType,
              JSON.stringify(item.options),
              itemIndex + 1,
            ]
          );
        }
      }

      return nextChecklistId;
    });

    res.json({
      success: true,
      checklistId,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const checklistId = Number(req.params.id);
    const { title, imagePath = "", sections = [] } = req.body || {};

    if (!checklistId || !title || !Array.isArray(sections)) {
      return res.status(400).json({
        message: "Invalid data",
      });
    }

    const checklist = await getChecklistForUser(checklistId, req);

    if (!checklist) {
      return res.status(404).json({
        message: "Checklist not found",
      });
    }

    const validSections = normalizeSections(sections);

    if (validSections.length === 0) {
      return res.status(400).json({
        message: "At least one valid section is required",
      });
    }

    await db.transaction(async (client) => {
      await client.query(
        "UPDATE checklists SET title = $1, image_path = $2 WHERE id = $3",
        [String(title).trim(), String(imagePath || "").trim(), checklistId]
      );

      await client.query("DELETE FROM checklist_sections WHERE checklist_id = $1", [
        checklistId,
      ]);

      for (const [sectionIndex, section] of validSections.entries()) {
        const sectionResult = await client.query(
          `
          INSERT INTO checklist_sections (checklist_id, title, sort_order)
          VALUES ($1, $2, $3)
          RETURNING id
        `,
          [checklistId, section.title, sectionIndex + 1]
        );

        const sectionId = sectionResult.rows[0].id;

        for (const [itemIndex, item] of section.items
          .map(normalizeChecklistItem)
          .filter((candidate) => candidate.question)
          .entries()) {
          await client.query(
            `
            INSERT INTO checklist_items
              (checklist_id, section_id, question, answer_type, options_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
            [
              checklistId,
              sectionId,
              item.question,
              item.answerType,
              JSON.stringify(item.options),
              itemIndex + 1,
            ]
          );
        }
      }
    });

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const checklistId = Number(req.params.id);
    const forceDelete = String(req.query.force || "").toLowerCase() === "true";

    if (!checklistId) {
      return res.status(400).json({
        message: "Invalid checklist id",
      });
    }

    const checklist = await getChecklistForUser(checklistId, req);

    if (!checklist) {
      return res.status(404).json({
        message: "Checklist not found",
      });
    }

    const assignmentCount = Number(
      (
        await db.one("SELECT COUNT(*)::int AS count FROM assignments WHERE checklist_id = $1", [
          checklistId,
        ])
      ).count
    );

    if (assignmentCount > 0 && !forceDelete) {
      return res.status(400).json({
        message:
          "This template cannot be deleted because assignments or reports are linked to it. Delete related completed reports first.",
      });
    }

    await db.query("DELETE FROM checklists WHERE id = $1", [checklistId]);

    res.json({
      success: true,
      forced: forceDelete || undefined,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
