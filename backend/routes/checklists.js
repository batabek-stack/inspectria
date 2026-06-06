const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const { sendTemplateShareEmail } = require("../services/emailService");

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

function hashShareToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createShareExpiry(days = 14) {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires.toISOString();
}

function publicAppUrl() {
  return (process.env.PUBLIC_APP_URL || "https://inspectria.com").replace(/\/+$/, "");
}

function buildTemplateImportUrl(token) {
  return `${publicAppUrl()}/login?templateShare=${encodeURIComponent(token)}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function copyChecklistToOrganization(client, sourceChecklistId, targetOrganizationId, titleSuffix = "") {
  const source = await client.query(
    `
    SELECT id, title, image_path
    FROM checklists
    WHERE id = $1
  `,
    [sourceChecklistId]
  );

  const checklist = source.rows[0];
  if (!checklist) {
    throw Object.assign(new Error("Shared template not found"), { statusCode: 404 });
  }

  const checklistResult = await client.query(
    `
    INSERT INTO checklists (organization_id, title, image_path, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
  `,
    [
      targetOrganizationId,
      `${checklist.title}${titleSuffix}`.trim(),
      checklist.image_path || "",
    ]
  );

  const nextChecklistId = checklistResult.rows[0].id;
  const sections = await client.query(
    `
    SELECT id, title, sort_order
    FROM checklist_sections
    WHERE checklist_id = $1
    ORDER BY sort_order
  `,
    [sourceChecklistId]
  );

  for (const section of sections.rows) {
    const sectionResult = await client.query(
      `
      INSERT INTO checklist_sections (checklist_id, title, sort_order)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [nextChecklistId, section.title, section.sort_order]
    );

    const nextSectionId = sectionResult.rows[0].id;
    const items = await client.query(
      `
      SELECT question, answer_type, options_json, sort_order
      FROM checklist_items
      WHERE checklist_id = $1 AND section_id = $2
      ORDER BY sort_order
    `,
      [sourceChecklistId, section.id]
    );

    for (const item of items.rows) {
      await client.query(
        `
        INSERT INTO checklist_items
          (checklist_id, section_id, question, answer_type, options_json, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          nextChecklistId,
          nextSectionId,
          item.question,
          item.answer_type || "FORMAT1",
          item.options_json || "[]",
          item.sort_order,
        ]
      );
    }
  }

  return {
    id: nextChecklistId,
    title: checklist.title,
  };
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

router.post("/:id/share", authRequired, adminOnly, async (req, res, next) => {
  try {
    const checklistId = Number(req.params.id);
    const recipientEmail = String(req.body?.email || "").trim().toLowerCase();

    if (!checklistId) {
      return res.status(400).json({ message: "Invalid checklist id" });
    }

    if (!isValidEmail(recipientEmail)) {
      return res.status(400).json({ message: "A valid recipient email is required" });
    }

    const checklist = await getChecklistForUser(checklistId, req);
    if (!checklist) {
      return res.status(404).json({ message: "Checklist not found" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashShareToken(token);
    const expiresAt = createShareExpiry();
    const importUrl = buildTemplateImportUrl(token);

    await db.query(
      `
      INSERT INTO template_shares
        (checklist_id, shared_by_user_id, source_organization_id, recipient_email, token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [
        checklist.id,
        req.user.id,
        checklist.organization_id,
        recipientEmail,
        tokenHash,
        expiresAt,
      ]
    );

    await sendTemplateShareEmail({
      to: recipientEmail,
      senderName: req.user.name || req.user.username,
      templateTitle: checklist.title,
      importUrl,
    });

    res.json({ success: true, expiresAt });
  } catch (error) {
    next(error);
  }
});

router.post("/shared/import", authRequired, adminOnly, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({ message: "Share token is required" });
    }

    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Your account is not linked to an organization" });
    }

    const tokenHash = hashShareToken(token);

    const imported = await db.transaction(async (client) => {
      const shareResult = await client.query(
        `
        SELECT
          ts.id,
          ts.checklist_id,
          ts.recipient_email,
          ts.imported_at,
          ts.expires_at,
          c.title
        FROM template_shares ts
        JOIN checklists c ON c.id = ts.checklist_id
        WHERE ts.token_hash = $1
        LIMIT 1
      `,
        [tokenHash]
      );

      const share = shareResult.rows[0];
      if (!share) {
        throw Object.assign(new Error("Shared template link is invalid"), { statusCode: 404 });
      }

      if (share.imported_at) {
        throw Object.assign(new Error("Shared template link was already imported"), {
          statusCode: 400,
        });
      }

      if (new Date(share.expires_at).getTime() < Date.now()) {
        throw Object.assign(new Error("Shared template link has expired"), { statusCode: 400 });
      }

      const nextChecklist = await copyChecklistToOrganization(
        client,
        share.checklist_id,
        req.user.organizationId
      );

      await client.query(
        `
        UPDATE template_shares
        SET imported_by_user_id = $1, imported_at = NOW()
        WHERE id = $2
      `,
        [req.user.id, share.id]
      );

      return nextChecklist;
    });

    res.json({
      success: true,
      checklistId: imported.id,
      title: imported.title,
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
