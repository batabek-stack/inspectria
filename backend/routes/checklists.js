const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const { sendTemplateShareEmail } = require("../services/emailService");

const router = express.Router();

const ANSWER_TYPES = new Set(["FORMAT1", "DATE", "TEXT", "MULTIPLE_CHOICE", "RADIO_BUTTON"]);
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_AZURE_API_VERSION = "2024-10-21";
const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_COLS = 20;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function extractJson(content) {
  const trimmed = normalizeText(content);
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }

  return null;
}

function sanitizeImportRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .slice(0, MAX_IMPORT_COLS)
        .map((cell) => normalizeText(cell).slice(0, 500))
    )
    .filter((row) => row.some(Boolean));
}

function findHeaderIndex(headers, candidates) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header === candidate || header.includes(candidate))
  );
}

function looksLikeHeader(row) {
  const headers = row.map(normalizeHeader);
  return (
    findHeaderIndex(headers, ["section", "bölüm", "bolum", "kategori", "alan"]) >= 0 ||
    findHeaderIndex(headers, ["question", "soru", "criteria", "kriter", "kontrol"]) >= 0 ||
    findHeaderIndex(headers, ["standard", "standart", "limit"]) >= 0
  );
}

function makeQuestionText(question, standard) {
  const cleanQuestion = normalizeText(question);
  const cleanStandard = normalizeText(standard);
  if (!cleanQuestion) return "";
  if (!cleanStandard || cleanQuestion.includes(cleanStandard)) return cleanQuestion;
  return `${cleanQuestion} (Standart: ${cleanStandard})`;
}

function normalizeImportAnswerType(value) {
  const normalized = normalizeText(value)
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^YES_?\/_?NO_?\/_?N\/?A$/, "FORMAT1")
    .replace(/^YES_?NO_?N\/?A$/, "FORMAT1")
    .replace(/^YES_NO_NA$/, "FORMAT1")
    .replace(/^YES_NO_N\/A$/, "FORMAT1");

  return ANSWER_TYPES.has(normalized) ? normalized : "FORMAT1";
}

function looksLikeAnswerType(value) {
  return normalizeImportAnswerType(value) !== "FORMAT1" || /^format\s*1$/i.test(normalizeText(value));
}

function fallbackImportSections(rows) {
  const sanitizedRows = sanitizeImportRows(rows);
  if (sanitizedRows.length === 0) return [];

  const hasHeader = looksLikeHeader(sanitizedRows[0]);
  const headers = hasHeader ? sanitizedRows[0].map(normalizeHeader) : [];
  const sourceRows = hasHeader ? sanitizedRows.slice(1) : sanitizedRows;
  const hasMultiColumnRows = sourceRows.some((row) => row[0] && row[1]);
  const secondColumnLooksLikeAnswerType = sourceRows.some((row) => looksLikeAnswerType(row[1] || ""));
  const sectionIndex = hasHeader
    ? findHeaderIndex(headers, ["section", "bölüm", "bolum", "kategori", "alan"])
    : hasMultiColumnRows && !secondColumnLooksLikeAnswerType
      ? 0
      : -1;
  const questionIndex = hasHeader
    ? findHeaderIndex(headers, ["question", "questions", "soru", "criteria", "kriter", "kontrol"])
    : hasMultiColumnRows
      ? secondColumnLooksLikeAnswerType
        ? 0
        : 1
      : 0;
  const answerTypeIndex = hasHeader
    ? findHeaderIndex(headers, ["answer type", "answer format", "type", "format", "yanıt tipi", "yanit tipi"])
    : secondColumnLooksLikeAnswerType
      ? 1
      : sourceRows.some((row) => looksLikeAnswerType(row[2] || ""))
        ? 2
        : -1;
  const standardIndex = hasHeader
    ? findHeaderIndex(headers, ["standard", "standart", "limit", "expected", "beklenen"])
    : answerTypeIndex < 0 && sourceRows.some((row) => row[2])
      ? 2
      : -1;

  const sections = [];
  const sectionMap = new Map();
  let currentSectionTitle = "Imported Questions";

  function ensureSection(title) {
    const cleanTitle = normalizeText(title) || "Imported Questions";
    const key = cleanTitle.toLocaleLowerCase("tr-TR");
    if (!sectionMap.has(key)) {
      const section = { title: cleanTitle, items: [] };
      sectionMap.set(key, section);
      sections.push(section);
    }

    return sectionMap.get(key);
  }

  sourceRows.forEach((row) => {
    const filledCells = row.filter(Boolean);
    if (filledCells.length === 0) return;

    const explicitSection = sectionIndex >= 0 ? normalizeText(row[sectionIndex]) : "";
    const rawQuestion = questionIndex >= 0 ? normalizeText(row[questionIndex]) : "";
    const rawAnswerType = answerTypeIndex >= 0 ? normalizeText(row[answerTypeIndex]) : "";
    const rawStandard = standardIndex >= 0 ? normalizeText(row[standardIndex]) : "";

    if (!rawQuestion && filledCells.length === 1) {
      currentSectionTitle = filledCells[0];
      ensureSection(currentSectionTitle);
      return;
    }

    const sectionTitle = explicitSection || currentSectionTitle;
    const question = makeQuestionText(rawQuestion || filledCells[0], rawStandard);
    if (!question) return;

    ensureSection(sectionTitle).items.push({
      question,
      answerType: normalizeImportAnswerType(rawAnswerType),
      options: [],
    });
  });

  return sections.filter((section) => section.items.length > 0);
}

function normalizeImportedChecklist(result, rows, fileName) {
  const fallbackSections = fallbackImportSections(rows);
  const rawSections = Array.isArray(result?.sections) ? result.sections : fallbackSections;
  const sections = normalizeSections(rawSections)
    .map((section) => ({
      title: section.title,
      items: section.items
        .map(normalizeChecklistItem)
        .filter((item) => item.question)
        .map((item) => ({
          ...item,
          answerType: ANSWER_TYPES.has(item.answerType) ? item.answerType : "FORMAT1",
        })),
    }))
    .filter((section) => section.items.length > 0);

  return {
    title:
      normalizeText(result?.title) ||
      normalizeText(fileName).replace(/\.(xlsx|csv)$/i, "") ||
      "Imported Template",
    sections: sections.length > 0 ? sections : fallbackSections,
    warnings: Array.isArray(result?.warnings)
      ? result.warnings.map(normalizeText).filter(Boolean).slice(0, 5)
      : [],
  };
}

function buildChecklistImportPayload({ rows, fileName, sheetName }) {
  return {
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You convert external spreadsheet checklists into Inspectria checklist templates.",
          "Return JSON only with: title, sections, warnings.",
          "Every source row that contains an inspection criterion, control point, or question must become exactly one checklist item.",
          "Question is the only required import column. Section and Answer Type columns are optional.",
          "If Section is missing or blank, put all questions into one section named Imported Questions.",
          "If Answer Type is missing or blank, use FORMAT1.",
          "Create sections from explicit Section/Bolum/Kategori columns, standalone heading rows, or logical groups.",
          "Do not create questions from header rows, notes, standards-only rows, or empty rows.",
          "If a row has both a criterion/question and a standard/limit, include the standard inside the question text in the same language.",
          "Use answerType FORMAT1 unless the row clearly asks for DATE, TEXT, MULTIPLE_CHOICE, or RADIO_BUTTON.",
          "Preserve the spreadsheet language and wording. Keep options empty unless answerType is a choice type.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          fileName,
          sheetName,
          rows,
          expectedShape: {
            title: "string",
            sections: [
              {
                title: "string",
                items: [
                  {
                    question: "string",
                    answerType: "FORMAT1 | DATE | TEXT | MULTIPLE_CHOICE | RADIO_BUTTON",
                    options: ["string"],
                  },
                ],
              },
            ],
            warnings: ["string"],
          },
        }),
      },
    ],
  };
}

async function callAzureChecklistImport(payload) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = normalizeText(process.env.AZURE_OPENAI_ENDPOINT).replace(/\/$/, "");
  const deployment = normalizeText(process.env.AZURE_OPENAI_DEPLOYMENT);
  if (!apiKey || !endpoint || !deployment) return null;

  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
  const response = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Azure OpenAI request failed";
    throw new Error(message);
  }

  return extractJson(data.choices?.[0]?.message?.content);
}

async function callOpenAiChecklistImport(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...payload,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "OpenAI request failed";
    throw new Error(message);
  }

  return extractJson(data.choices?.[0]?.message?.content);
}

async function buildAiImportedChecklist({ rows, fileName, sheetName }) {
  const sanitizedRows = sanitizeImportRows(rows);
  const payload = buildChecklistImportPayload({ rows: sanitizedRows, fileName, sheetName });
  const warnings = [];

  try {
    const azureResult = await callAzureChecklistImport(payload);
    if (azureResult) {
      return {
        provider: "azure-openai",
        ...normalizeImportedChecklist(azureResult, sanitizedRows, fileName),
      };
    }
  } catch (error) {
    warnings.push(`Azure OpenAI import review failed: ${error.message || "unknown error"}`);
  }

  try {
    const openAiResult = await callOpenAiChecklistImport(payload);
    if (openAiResult) {
      return {
        provider: "openai",
        ...normalizeImportedChecklist(openAiResult, sanitizedRows, fileName),
      };
    }
  } catch (error) {
    warnings.push(`OpenAI import review failed: ${error.message || "unknown error"}`);
  }

  return {
    provider: "fallback",
    ...normalizeImportedChecklist(null, sanitizedRows, fileName),
    warnings: warnings.length
      ? warnings
      : ["AI credentials are not configured; local import rules were used."],
  };
}

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
  const conditionalSectionTitle =
    answerType === "FORMAT1" ? String(item?.conditionalSectionTitle || "").trim() : "";
  const conditionalItems =
    answerType === "FORMAT1" && Array.isArray(item?.conditionalItems)
      ? item.conditionalItems
          .map(normalizeChecklistItem)
          .filter((conditionalItem) => conditionalItem.question)
          .map((conditionalItem) => ({
            question: conditionalItem.question,
            answerType: conditionalItem.answerType,
            options: conditionalItem.options,
            conditionalSectionTitle: "",
            conditionalItems: [],
          }))
      : [];

  return {
    question,
    answerType,
    options: ["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(answerType) ? options : [],
    conditionalSectionTitle: "",
    conditionalItems,
  };
}

function mapDbItem(item) {
  let options = [];
  let conditionalItems = [];
  try {
    options = item.options_json ? JSON.parse(item.options_json) : [];
  } catch {
    options = [];
  }
  try {
    conditionalItems = item.conditional_items_json
      ? JSON.parse(item.conditional_items_json)
      : [];
  } catch {
    conditionalItems = [];
  }

  return {
    ...item,
    answerType: item.answer_type || "FORMAT1",
    options,
    conditionalSectionTitle: item.conditional_section_title || "",
    conditionalItems: Array.isArray(conditionalItems) ? conditionalItems : [],
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
  return `${publicAppUrl()}/#login?templateShare=${encodeURIComponent(token)}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function copyChecklistToOrganization(client, sourceChecklistId, targetOrganizationId, titleSuffix = "") {
  await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [
    Number(targetOrganizationId),
    Number(sourceChecklistId),
  ]);

  const source = await client.query(
    `
    SELECT id, organization_id, title, image_path
    FROM checklists
    WHERE id = $1
  `,
    [sourceChecklistId]
  );

  const checklist = source.rows[0];
  if (!checklist) {
    throw Object.assign(new Error("Shared template not found"), { statusCode: 404 });
  }

  if (checklist.organization_id === targetOrganizationId) {
    return {
      id: checklist.id,
      title: checklist.title,
      reused: true,
    };
  }

  const existingImport = await client.query(
    `
    SELECT id, title
    FROM checklists
    WHERE organization_id = $1
      AND imported_from_checklist_id = $2
    ORDER BY id DESC
    LIMIT 1
  `,
    [targetOrganizationId, sourceChecklistId]
  );

  if (existingImport.rows[0]) {
    return {
      id: existingImport.rows[0].id,
      title: existingImport.rows[0].title,
      reused: true,
    };
  }

  const checklistResult = await client.query(
    `
    INSERT INTO checklists
      (organization_id, imported_from_checklist_id, title, image_path, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id
  `,
    [
      targetOrganizationId,
      sourceChecklistId,
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
      SELECT question, answer_type, options_json, conditional_section_title, conditional_items_json, sort_order
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
          (checklist_id, section_id, question, answer_type, options_json, conditional_section_title, conditional_items_json, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          nextChecklistId,
          nextSectionId,
          item.question,
          item.answer_type || "FORMAT1",
          item.options_json || "[]",
          item.conditional_section_title || "",
          item.conditional_items_json || "[]",
          item.sort_order,
        ]
      );
    }
  }

  return {
    id: nextChecklistId,
    title: checklist.title,
    reused: false,
  };
}

async function getChecklistWithSections(checklist) {
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

router.get("/community", authRequired, async (req, res, next) => {
  try {
    const rows = await db.many(
      `
      SELECT
        c.*,
        ct.id AS "communityTemplateId",
        ct.created_at AS "sharedAt",
        u.name AS "sharedByName",
        u.username AS "sharedByUsername",
        o.name AS "sharedByOrganizationName"
      FROM community_templates ct
      JOIN checklists c ON c.id = ct.checklist_id
      LEFT JOIN users u ON u.id = ct.shared_by_user_id
      LEFT JOIN organizations o ON o.id = ct.source_organization_id
      ORDER BY ct.created_at DESC, ct.id DESC
    `
    );

    const result = await Promise.all(rows.map(getChecklistWithSections));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/community", authRequired, async (req, res, next) => {
  try {
    const checklistId = Number(req.params.id);
    if (!checklistId) return res.status(400).json({ message: "Invalid template id" });

    const params = [checklistId];
    const accessWhere = db.isPlatformAdmin(req.user)
      ? ""
      : `AND c.organization_id = $${params.push(req.user.organizationId)}`;
    const checklist = await db.one(
      `
      SELECT c.id, c.organization_id, c.title
      FROM checklists c
      WHERE c.id = $1
      ${accessWhere}
    `,
      params
    );

    if (!checklist) return res.status(404).json({ message: "Template not found" });

    const shared = await db.one(
      `
      INSERT INTO community_templates
        (checklist_id, shared_by_user_id, source_organization_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (checklist_id)
      DO UPDATE SET
        shared_by_user_id = EXCLUDED.shared_by_user_id,
        source_organization_id = EXCLUDED.source_organization_id
      RETURNING id
    `,
      [checklist.id, req.user.id, checklist.organization_id]
    );

    res.json({ success: true, communityTemplateId: shared.id });
  } catch (error) {
    next(error);
  }
});

router.post("/community/:id/import", authRequired, async (req, res, next) => {
  try {
    const communityTemplateId = Number(req.params.id);
    const targetOrganizationId = req.user.organizationId;
    if (!communityTemplateId) return res.status(400).json({ message: "Invalid community template id" });
    if (!targetOrganizationId) return res.status(400).json({ message: "Organization is required" });

    const communityTemplate = await db.one(
      `
      SELECT ct.id, ct.checklist_id
      FROM community_templates ct
      WHERE ct.id = $1
    `,
      [communityTemplateId]
    );

    if (!communityTemplate) {
      return res.status(404).json({ message: "Community template not found" });
    }

    const result = await db.transaction((client) =>
      copyChecklistToOrganization(client, communityTemplate.checklist_id, targetOrganizationId)
    );

    res.json({
      success: true,
      checklistId: result.id,
      title: result.title,
      reused: result.reused,
    });
  } catch (error) {
    next(error);
  }
});

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

    const result = await Promise.all(checklists.map(getChecklistWithSections));

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
              (checklist_id, section_id, question, answer_type, options_json, conditional_section_title, conditional_items_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
            [
              nextChecklistId,
              sectionId,
              item.question,
              item.answerType,
              JSON.stringify(item.options),
              item.conditionalSectionTitle,
              JSON.stringify(item.conditionalItems),
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

router.post("/import/preview", authRequired, adminOnly, async (req, res, next) => {
  try {
    const rows = sanitizeImportRows(req.body?.rows);
    const fileName = normalizeText(req.body?.fileName);
    const sheetName = normalizeText(req.body?.sheetName);

    if (rows.length === 0) {
      return res.status(400).json({ message: "Excel file does not contain importable rows" });
    }

    const imported = await buildAiImportedChecklist({ rows, fileName, sheetName });

    if (!Array.isArray(imported.sections) || imported.sections.length === 0) {
      return res.status(400).json({ message: "No checklist questions could be detected" });
    }

    res.json(imported);
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

    const share = await db.one(
      `
      INSERT INTO template_shares
        (checklist_id, shared_by_user_id, source_organization_id, recipient_email, token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
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

    const recipients = await db.many(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
        AND active = TRUE
        AND approval_status = 'approved'
    `,
      [recipientEmail]
    );

    if (recipients.length > 0) {
      await Promise.all(
        recipients.map((recipient) =>
          db.query(
            `
            INSERT INTO app_messages
              (recipient_user_id, sender_user_id, template_share_id, message_type, title, body)
            VALUES ($1, $2, $3, 'template_share', $4, $5)
          `,
            [
              recipient.id,
              req.user.id,
              share.id,
              `Template shared: ${checklist.title}`,
              `${
                req.user.name || req.user.username
              } shared the ${checklist.title} template with you. Click Import Template to add it to your Templates.`,
            ]
          )
        )
      );
    }

    let emailSent = true;
    let emailError = "";
    try {
      await sendTemplateShareEmail({
        to: recipientEmail,
        senderName: req.user.name || req.user.username,
        templateTitle: checklist.title,
        importUrl,
      });
    } catch (error) {
      emailSent = false;
      emailError = error instanceof Error ? error.message : "Email could not be sent";
    }

    if (!emailSent && recipients.length === 0) {
      return res.status(400).json({
        message:
          "Email could not be sent, and no active app user was found for this recipient email.",
      });
    }

    res.json({
      success: true,
      expiresAt,
      emailSent,
      emailError: emailSent ? undefined : emailError,
      appMessageCount: recipients.length,
    });
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
      reused: imported.reused,
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
              (checklist_id, section_id, question, answer_type, options_json, conditional_section_title, conditional_items_json, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
            [
              checklistId,
              sectionId,
              item.question,
              item.answerType,
              JSON.stringify(item.options),
              item.conditionalSectionTitle,
              JSON.stringify(item.conditionalItems),
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
