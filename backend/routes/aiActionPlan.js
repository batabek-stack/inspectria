const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_AZURE_API_VERSION = "2024-10-21";
const INSPECTRIA_DARK_GREEN = "#06323f";
const LOGO_PATH = path.join(__dirname, "..", "..", "frontend", "public", "inspectra-logo.png");
let cachedLogoBuffer = null;

const DEFAULT_INDUSTRY_PROFILE = {
  industry: "Hotel / Hospitality",
  operatingContext:
    "Checklist failures may relate to guest-facing areas, rooms, cleaning, maintenance, safety, food service, finance, IT, HR, security, or general operations.",
  departments: [
    {
      name: "Housekeeping",
      ownerRole: "Housekeeping Supervisor",
      owns: "cleanliness, room readiness, linen, public area tidiness, waste removal, visible dust or disorder",
      aliases: ["clean", "cleaning", "temiz", "tidy", "duzen", "dust", "linen", "waste", "trash", "garbage", "public area", "guest room"],
    },
    {
      name: "Engineering",
      ownerRole: "Engineering Technician",
      owns: "maintenance, repair, plumbing, electrical, HVAC, lighting, equipment defects, physical damage",
      aliases: ["maintenance", "repair", "broken", "damage", "leak", "electric", "lighting", "hvac", "air conditioning", "klima", "temperature", "plumbing"],
    },
    {
      name: "HSE",
      ownerRole: "HSE Officer",
      owns: "fire safety, emergency exits, occupational safety, unsafe conditions, regulatory safety controls",
      aliases: ["fire", "alarm", "emergency", "safety", "unsafe", "exit", "hse", "acil", "yangin"],
    },
    {
      name: "Food & Beverage",
      ownerRole: "F&B Supervisor",
      owns: "restaurant, buffet, kitchen, food hygiene, service setup, minibar or dining operations",
      aliases: ["restaurant", "buffet", "kitchen", "food", "beverage", "minibar", "f&b", "mutfak", "gida"],
    },
    {
      name: "Front Office",
      ownerRole: "Front Office Supervisor",
      owns: "reception, guest arrival, reservations, check-in, guest documents, lobby service process",
      aliases: ["reception", "front office", "reservation", "check-in", "check in", "guest arrival", "lobby service"],
    },
    {
      name: "Security",
      ownerRole: "Security Supervisor",
      owns: "access control, CCTV, guarding, incident response, restricted areas, lost and found security risk",
      aliases: ["security", "cctv", "camera", "access", "guard", "restricted", "incident", "guvenlik"],
    },
    {
      name: "Finance",
      ownerRole: "Finance Supervisor",
      owns: "billing, invoices, cash, payment controls, price discrepancies, financial documentation",
      aliases: ["invoice", "billing", "payment", "cash", "finance", "price", "fatura", "odeme", "kasa"],
    },
    {
      name: "IT",
      ownerRole: "IT Specialist",
      owns: "network, POS systems, software access, printers, devices, internet, system availability",
      aliases: ["it", "server", "server room", "network", "pos", "software", "printer", "internet", "device", "system"],
    },
    {
      name: "HR",
      ownerRole: "HR Supervisor",
      owns: "training records, staff files, uniforms policy, attendance, employee documentation",
      aliases: ["training", "staff", "employee", "uniform", "attendance", "hr", "personnel"],
    },
    {
      name: "Operations",
      ownerRole: "Operations Supervisor",
      owns: "cross-department process gaps, unclear ownership, general operating standards, coordination issues",
      aliases: ["operations", "process", "standard", "coordination", "procedure"],
    },
  ],
  durationGuidance: [
    "Simple cleaning or tidying: 15-30 minutes",
    "Room or public area setup correction: 30-60 minutes",
    "Small maintenance adjustment: 30-120 minutes",
    "Part replacement or vendor-dependent technical issue: 1-3 days",
    "Critical safety issue: immediate containment, then corrective action on the same day",
    "Documentation or finance correction: 30-90 minutes unless approval is required",
  ],
};

function normalizeText(value) {
  return String(value || "").trim();
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getIndustryProfile() {
  const profile = parseJsonEnv("ACTION_PLAN_INDUSTRY_PROFILE_JSON", null);
  if (profile && Array.isArray(profile.departments) && profile.departments.length > 0) {
    return profile;
  }

  return {
    ...DEFAULT_INDUSTRY_PROFILE,
    industry: process.env.ACTION_PLAN_INDUSTRY || DEFAULT_INDUSTRY_PROFILE.industry,
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function inferDueDays(priority, estimatedDurationMinutes) {
  if (priority === "Critical") return 1;
  if (priority === "High") return estimatedDurationMinutes > 240 ? 2 : 1;
  if (estimatedDurationMinutes <= 120) return 1;
  return 3;
}

function findDepartment(profile, name) {
  const cleanName = normalizeText(name).toLowerCase();
  return (profile.departments || []).find((department) => {
    return normalizeText(department.name).toLowerCase() === cleanName;
  });
}

function fallbackDepartment(item, profile) {
  const text = `${item.sectionTitle || item.section_title || ""} ${item.question || ""} ${item.comment || ""}`.toLowerCase();
  const section = normalizeText(item.sectionTitle || item.section_title).toLowerCase();
  const departments = profile.departments || [];

  const scored = departments.map((department) => {
    const departmentName = normalizeText(department.name).toLowerCase();
    const ownsPhrases = normalizeText(department.owns)
      .toLowerCase()
      .split(",")
      .map((phrase) => phrase.trim())
      .filter(Boolean);
    const aliases = Array.isArray(department.aliases) ? department.aliases : [];
    let score = 0;

    if (section && departmentName.includes(section)) score += 5;
    if (section && section.includes(departmentName)) score += 5;

    score += ownsPhrases.reduce((total, phrase) => {
      return text.includes(phrase) ? total + 3 : total;
    }, 0);

    score += aliases.reduce((total, alias) => {
      return text.includes(normalizeText(alias).toLowerCase()) ? total + 2 : total;
    }, 0);

    return { department, score };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) {
    return {
      ...scored[0].department,
      confidence: scored[0].score >= 2 ? "Medium" : "Low",
      reason: "Local fallback matched the failed item against the department responsibility descriptions.",
    };
  }

  const operations = findDepartment(profile, "Operations") || departments[0] || {
    name: "Operations",
    ownerRole: "Operations Supervisor",
  };

  return {
    ...operations,
    confidence: "Low",
    reason: "Local fallback could not confidently infer a specialized department.",
  };
}

function fallbackPriority(item) {
  const text = `${item.question || ""} ${item.comment || ""}`.toLowerCase();

  if (/(fire|alarm|emergency|unsafe|safety|yangin|acil|tehlike)/i.test(text)) return "Critical";
  if (/(broken|damage|leak|missing|ariza|hasar|eksik|sizinti)/i.test(text)) return "High";
  return "Medium";
}

function fallbackDuration(item, departmentName) {
  const text = `${item.question || ""} ${item.comment || ""}`.toLowerCase();

  if (/(clean|temiz|tidy|duzen|dust|trash|cop|garbage)/i.test(text)) return 30;
  if (/(document|invoice|payment|fatura|odeme|record)/i.test(text)) return 60;
  if (/(fire|alarm|emergency|unsafe|safety|yangin|acil)/i.test(text)) return 60;
  if (/(broken|repair|leak|electric|hvac|klima|ariza|tamir)/i.test(text)) return 120;
  if (departmentName === "Operations") return 60;
  return 45;
}

function fallbackPlan(report, failedItems, profile) {
  const today = new Date();

  return failedItems.map((item, index) => {
    const department = fallbackDepartment(item, profile);
    const priority = fallbackPriority(item);
    const estimatedDurationMinutes = fallbackDuration(item, department.name);
    const issue = normalizeText(item.question) || `Failed item ${index + 1}`;

    return {
      failedItemId: String(item.id || item.checklist_item_id || index + 1),
      reportId: String(report.id || ""),
      checklistTitle: normalizeText(report.checklistTitle),
      sectionTitle: normalizeText(item.sectionTitle || item.section_title),
      issue,
      failedAnswer: normalizeText(item.answer) || "NO",
      comment: normalizeText(item.comment),
      department: department.name,
      owner: department.ownerRole || `${department.name} Supervisor`,
      departmentReason: department.reason,
      rootCause: "The failed answer indicates the operating standard was not met and needs owner review.",
      correctiveAction: `${department.name} should inspect the failed item, correct the condition, and add completion evidence.`,
      preventiveAction: "Review the related routine control and confirm the responsible owner understands the expected standard.",
      priority,
      estimatedDurationMinutes,
      confidence: department.confidence,
      dueDate: addDays(today, inferDueDays(priority, estimatedDurationMinutes)),
      status: "Open",
      progress: 0,
      followUpNotes: "",
    };
  });
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

function normalizeActionPlans(report, failedItems, actionPlans, profile) {
  const fallback = fallbackPlan(report, failedItems, profile);
  const plans = Array.isArray(actionPlans) ? actionPlans : [];
  const today = new Date();

  return fallback.map((base, index) => {
    const plan = plans[index] || {};
    const departmentName = normalizeText(plan.department) || base.department;
    const department = findDepartment(profile, departmentName);
    const priority = normalizeText(plan.priority) || base.priority;
    const estimatedDurationMinutes = Number.isFinite(Number(plan.estimatedDurationMinutes))
      ? Number(plan.estimatedDurationMinutes)
      : base.estimatedDurationMinutes;

    return {
      ...base,
      failedItemId: normalizeText(plan.failedItemId) || base.failedItemId,
      issue: normalizeText(plan.issue) || base.issue,
      department: departmentName,
      owner: normalizeText(plan.owner) || department?.ownerRole || base.owner,
      departmentReason: normalizeText(plan.departmentReason) || base.departmentReason,
      rootCause: normalizeText(plan.rootCause) || base.rootCause,
      correctiveAction: normalizeText(plan.correctiveAction) || base.correctiveAction,
      preventiveAction: normalizeText(plan.preventiveAction) || base.preventiveAction,
      priority,
      estimatedDurationMinutes,
      confidence: normalizeText(plan.confidence) || base.confidence,
      dueDate:
        normalizeText(plan.dueDate) ||
        addDays(today, inferDueDays(priority, estimatedDurationMinutes)),
      status: normalizeText(plan.status) || "Open",
      progress: Number.isFinite(Number(plan.progress)) ? Number(plan.progress) : base.progress,
      followUpNotes: normalizeText(plan.followUpNotes) || "",
    };
  });
}

function buildAiPayload(report, failedItems, profile) {
  return {
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are an operational audit assistant.",
          "Analyze each failed checklist item deeply and classify the most likely operational owner.",
          "Do not write generic plans.",
          "Choose the best department from the provided industry profile.",
          "Estimate a realistic completion time in minutes based on actual operational effort.",
          "Create a specific corrective action that the assigned department can execute.",
          "Use the same language as the checklist question when practical.",
          "Return only valid JSON with an actionPlans array.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "For every failed item, choose department, owner, priority, estimated duration, due date, confidence, department reason, root cause, corrective action, preventive action, and follow-up notes.",
          constraints: [
            "department must be selected from industryProfile.departments unless no listed department is reasonable",
            "owner should normally be the selected department's ownerRole",
            "estimatedDurationMinutes must be realistic, not arbitrary",
            "confidence must be High, Medium, or Low",
            "departmentReason must briefly explain why the selected department owns the issue",
            "avoid Responsible team, General team, or generic ownership",
          ],
          expectedShape: {
            actionPlans: [
              {
                failedItemId: "string",
                issue: "string",
                department: "string",
                owner: "string",
                departmentReason: "string",
                rootCause: "string",
                correctiveAction: "string",
                preventiveAction: "string",
                priority: "Critical | High | Medium | Low",
                estimatedDurationMinutes: 30,
                dueDate: "YYYY-MM-DD",
                status: "Open",
                progress: 0,
                confidence: "High | Medium | Low",
                followUpNotes: "string",
              },
            ],
          },
          industryProfile: profile,
          report: {
            id: report.id,
            checklistTitle: report.checklistTitle,
            completedAt: report.completed_at || report.completedAt,
            completedByName: report.completedByName,
            assignedToName: report.assignedToName,
            assignedByName: report.assignedByName,
          },
          failedItems,
        }),
      },
    ],
  };
}

function buildManagerSummaryPayload(report, failedItems, profile) {
  return {
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are an executive operations reporting assistant.",
          "Write a concise manager summary from failed checklist items.",
          "Interpret the negative findings, explain operational risk, and group related issues when useful.",
          "Do not create an action-plan table.",
          "Use clear management language and the same language as the checklist content when practical.",
          "Return only valid JSON with summaryTitle and summaryText strings.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Create a manager-facing narrative summary of the failed checklist items.",
          constraints: [
            "summaryText should be plain paragraphs, not markdown",
            "mention the most important risk patterns",
            "include practical interpretation of what the negative items may mean for operations",
            "avoid inventing facts that are not implied by the report",
            "do not list every item mechanically unless the report is very short",
          ],
          expectedShape: {
            summaryTitle: "string",
            summaryText: "string",
          },
          industryProfile: profile,
          report: {
            id: report.id,
            checklistTitle: report.checklistTitle,
            completedAt: report.completed_at || report.completedAt,
            completedByName: report.completedByName,
            assignedToName: report.assignedToName,
            assignedByName: report.assignedByName,
          },
          failedItems,
        }),
      },
    ],
  };
}

async function callAzureOpenAi(report, failedItems, profile) {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = normalizeText(process.env.AZURE_OPENAI_ENDPOINT).replace(/\/$/, "");
  const deployment = normalizeText(process.env.AZURE_OPENAI_DEPLOYMENT);

  if (!apiKey || !endpoint || !deployment) return null;

  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
  const payload = buildAiPayload(report, failedItems, profile);
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

async function callAzureOpenAiWithPayload(payload) {
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

async function callOpenAi(report, failedItems, profile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const payload = {
    model,
    ...buildAiPayload(report, failedItems, profile),
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || "OpenAI request failed";
    throw new Error(message);
  }

  return extractJson(data.choices?.[0]?.message?.content);
}

async function callOpenAiWithPayload(payload) {
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

async function callAiProvider(report, failedItems, profile) {
  const azureResult = await callAzureOpenAi(report, failedItems, profile);
  if (azureResult) return { provider: "azure-openai", result: azureResult };

  const openAiResult = await callOpenAi(report, failedItems, profile);
  if (openAiResult) return { provider: "openai", result: openAiResult };

  return { provider: "fallback", result: null };
}

async function callAiProviderWithPayload(payload) {
  const azureResult = await callAzureOpenAiWithPayload(payload);
  if (azureResult) return { provider: "azure-openai", result: azureResult };

  const openAiResult = await callOpenAiWithPayload(payload);
  if (openAiResult) return { provider: "openai", result: openAiResult };

  return { provider: "fallback", result: null };
}

function fallbackManagerSummary(report, failedItems, profile) {
  const checklistTitle = normalizeText(report.checklistTitle) || "Selected checklist";
  const sections = [...new Set(failedItems.map((item) => normalizeText(item.sectionTitle || item.section_title)).filter(Boolean))];
  const comments = failedItems.map((item) => normalizeText(item.comment)).filter(Boolean);
  const examples = failedItems
    .slice(0, 5)
    .map((item) => normalizeText(item.question))
    .filter(Boolean);

  const sectionText = sections.length
    ? `The negative findings are concentrated around ${sections.join(", ")}.`
    : "The negative findings are spread across the completed checklist.";
  const commentText = comments.length
    ? `Inspector comments indicate: ${comments.slice(0, 4).join("; ")}.`
    : "No detailed inspector comments were provided for these negative findings.";
  const exampleText = examples.length
    ? `Key examples include ${examples.join("; ")}.`
    : "The failed items should be reviewed with the responsible operational owners.";

  return {
    summaryTitle: `Manager Summary - ${checklistTitle}`,
    summaryText: [
      `${checklistTitle} includes ${failedItems.length} negative checklist item${failedItems.length === 1 ? "" : "s"} requiring management attention.`,
      `${sectionText} ${exampleText}`,
      `${commentText} These items suggest that the expected operating standard was not fully met and should be reviewed for immediate correction, ownership, and follow-up evidence.`,
      `This summary was generated with local fallback logic for the ${profile.industry || "configured"} profile. Add Azure OpenAI or OpenAI credentials on the backend for AI-written narrative analysis.`,
    ].join("\n\n"),
  };
}

function normalizeManagerSummary(report, failedItems, summary, profile) {
  const fallback = fallbackManagerSummary(report, failedItems, profile);
  const summaryTitle = normalizeText(summary?.summaryTitle) || fallback.summaryTitle;
  const summaryText = normalizeText(summary?.summaryText) || fallback.summaryText;

  return {
    summaryTitle,
    summaryText,
  };
}

function parseMaybeJson(value, fallback) {
  if (typeof value !== "string") return value || fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getLogoBuffer() {
  if (cachedLogoBuffer) return cachedLogoBuffer;

  try {
    cachedLogoBuffer = fs.readFileSync(LOGO_PATH);
  } catch {
    cachedLogoBuffer = null;
  }

  return cachedLogoBuffer;
}

const CRC_TABLE = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function excelColumnName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function cellXml(rowIndex, columnIndex, value, style = 2) {
  const ref = `${excelColumnName(columnIndex)}${rowIndex}`;
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}" s="${style}"/>`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }

  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function buildActionPlanXlsx(actionPlans, report) {
  const logo = getLogoBuffer();
  const columns = [
    ["sectionTitle", "Section", 24],
    ["issue", "Issue", 44],
    ["comment", "Comment", 34],
    ["department", "Department", 18],
    ["estimatedDurationMinutes", "Estimated Duration (min)", 16],
    ["correctiveAction", "Corrective Action", 58],
    ["preventiveAction", "Preventive Action", 58],
    ["priority", "Priority", 14],
    ["owner", "Owner", 24],
    ["dueDate", "Due Date", 14],
    ["status", "Status", 14],
    ["confidence", "Confidence", 14],
    ["followUpNotes", "Follow-up Notes", 36],
  ];
  const headerRow = 3;
  const lastRow = Math.max(headerRow, headerRow + actionPlans.length);
  const lastColumn = excelColumnName(columns.length - 1);
  const title = `${report.checklistTitle || "Inspectria"} - AI Action Plan`;
  const columnXml = columns
    .map(([, , width], index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const rows = [
    `<row r="1" ht="58" customHeight="1"></row>`,
    `<row r="2" ht="28" customHeight="1">${cellXml(2, 2, title, 3)}</row>`,
    `<row r="${headerRow}" ht="30" customHeight="1">${columns
      .map(([, label], index) => cellXml(headerRow, index, label, 1))
      .join("")}</row>`,
    ...actionPlans.map((plan, rowOffset) => {
      const rowIndex = headerRow + rowOffset + 1;
      return `<row r="${rowIndex}" ht="64" customHeight="1">${columns
        .map(([key], index) => cellXml(rowIndex, index, plan[key], 2))
        .join("")}</row>`;
    }),
  ];
  const hasLogo = Boolean(logo);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${hasLogo ? '<Default Extension="png" ContentType="image/png"/>' : ""}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${hasLogo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="AI Action Plan" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF092934"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="18"/><color rgb="FF06323F"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF06323F"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFB9D3D1"/></left>
      <right style="thin"><color rgb="FFB9D3D1"/></right>
      <top style="thin"><color rgb="FFB9D3D1"/></top>
      <bottom style="thin"><color rgb="FFB9D3D1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const worksheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/inspectria-logo.png"/>
</Relationships>`;
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from>
    <xdr:ext cx="1600200" cy="419100"/>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="1" name="Inspectria Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columnXml}</cols>
  <sheetData>${rows.join("")}</sheetData>
  ${hasLogo ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
  const entries = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: worksheet },
  ];

  if (hasLogo) {
    entries.push(
      { name: "xl/worksheets/_rels/sheet1.xml.rels", data: worksheetRels },
      { name: "xl/drawings/drawing1.xml", data: drawing },
      { name: "xl/drawings/_rels/drawing1.xml.rels", data: drawingRels },
      { name: "xl/media/inspectria-logo.png", data: logo }
    );
  }

  return createZip(entries);
}

function safeDownloadName(value, suffix) {
  const clean = normalizeText(value || "Inspectria")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return `${clean || "Inspectria"}_${suffix}`;
}

function isNegativeAnswer(answer) {
  const normalized = normalizeText(answer)
    .toLowerCase()
    .replace(/\u0131/g, "i")
    .replace(/\u015f/g, "s")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c");
  return ["no", "fail", "failed", "false"].includes(normalized);
}

async function getReportForAiDownload(reportId, user) {
  const params = [reportId];
  const where = ["r.id = $1"];

  if (user && !db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`r.organization_id = $${params.length}`);
  }

  if (user && user.role === "user") {
    params.push(user.id);
    where.push(`a.assigned_to_user_id = $${params.length}`);
  }

  const report = await db.one(
    `
      SELECT
        r.id,
        r.assignment_id,
        r.completed_by_user_id,
        r.completed_at,
        r.status,
        c.title AS "checklistTitle",
        u1.name AS "completedByName",
        u2.name AS "assignedToName",
        u3.name AS "assignedByName"
      FROM reports r
      JOIN assignments a ON r.assignment_id = a.id
      JOIN checklists c ON a.checklist_id = c.id
      JOIN users u1 ON r.completed_by_user_id = u1.id
      JOIN users u2 ON a.assigned_to_user_id = u2.id
      JOIN users u3 ON a.assigned_by_user_id = u3.id
      WHERE ${where.join(" AND ")}
    `,
    params
  );

  if (!report) return null;

  const items = await db.many(
    `
      SELECT
        id,
        checklist_item_id,
        question,
        answer,
        answer_type AS "answerType",
        comment,
        section_title AS "sectionTitle"
      FROM report_items
      WHERE report_id = $1
      ORDER BY id ASC
    `,
    [report.id]
  );

  return {
    ...report,
    items,
  };
}

async function getUserFromDownloadToken(req) {
  const authHeader = req.headers.authorization || "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const token = headerToken || normalizeText(req.query.token);

  if (!token) return null;

  const session = await db.one(
    `
      SELECT
        s.*,
        u.id AS user_id,
        u.organization_id,
        u.username,
        u.name,
        u.role,
        u.active,
        u.approval_status,
        o.name AS organization_name,
        COALESCE(o.active, TRUE) AS organization_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE s.token = $1
    `,
    [token]
  );

  if (!session) return null;
  if (!session.active || !session.organization_active) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  return {
    id: session.user_id,
    organizationId: session.organization_id,
    organizationName: session.organization_name,
    username: session.username,
    name: session.name,
    role: session.role,
    active: Boolean(session.active),
    approvalStatus: session.approval_status,
  };
}

async function sendActionPlanExcel(res, report, failedItems) {
  const profile = getIndustryProfile();
  const ai = await callAiProvider(report, failedItems, profile);
  const actionPlans = normalizeActionPlans(
    report,
    failedItems,
    ai.result?.actionPlans,
    profile
  );
  const workbook = buildActionPlanXlsx(actionPlans, report);
  const fileName = safeDownloadName(report.checklistTitle, "AI_Action_Plan.xlsx");

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  res.setHeader("Cache-Control", "no-store");
  return res.send(workbook);
}

router.post("/action-plan", authRequired, adminOnly, async (req, res) => {
  const { report, failedItems } = req.body || {};

  if (!report || !Array.isArray(failedItems)) {
    return res.status(400).json({ message: "report and failedItems are required" });
  }

  if (failedItems.length === 0) {
    return res.json({
      provider: "none",
      actionPlans: [],
    });
  }

  try {
    const profile = getIndustryProfile();
    const ai = await callAiProvider(report, failedItems, profile);
    const actionPlans = normalizeActionPlans(
      report,
      failedItems,
      ai.result?.actionPlans,
      profile
    );

    return res.json({
      provider: ai.provider,
      industry: profile.industry,
      actionPlans,
    });
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "AI action plan could not be generated",
    });
  }
});

router.post("/action-plan-excel", async (req, res) => {
  const report = parseMaybeJson(req.body?.report, null);
  const failedItems = parseMaybeJson(req.body?.failedItems, []);

  if (!report || !Array.isArray(failedItems)) {
    return res.status(400).send("report and failedItems are required");
  }

  if (failedItems.length === 0) {
    return res.status(400).send("No negative YES/NO checklist items found");
  }

  try {
    return await sendActionPlanExcel(res, report, failedItems);
  } catch (err) {
    return res.status(502).send(
      err instanceof Error ? err.message : "AI action plan Excel could not be generated"
    );
  }
});

router.get("/reports/:id/action-plan-excel", async (req, res) => {
  const reportId = Number(req.params.id);
  if (!reportId) return res.status(400).send("Invalid report id");

  try {
    const user = await getUserFromDownloadToken(req);
    const report = await getReportForAiDownload(reportId, user);
    if (!report) return res.status(404).send("Report not found");

    const failedItems = (report.items || []).filter((item) => {
      const answerType = item.answerType || item.answer_type || "FORMAT1";
      return answerType === "FORMAT1" && isNegativeAnswer(item.answer);
    });

    if (failedItems.length === 0) {
      return res.status(400).send("No negative YES/NO checklist items found");
    }

    return await sendActionPlanExcel(res, report, failedItems);
  } catch (err) {
    return res.status(502).send(
      err instanceof Error ? err.message : "AI action plan Excel could not be generated"
    );
  }
});

router.post("/manager-summary", authRequired, async (req, res) => {
  const { report, failedItems } = req.body || {};

  if (!report || !Array.isArray(failedItems)) {
    return res.status(400).json({ message: "report and failedItems are required" });
  }

  if (failedItems.length === 0) {
    return res.json({
      provider: "none",
      summaryTitle: "Manager Summary",
      summaryText: "No negative YES/NO checklist items were found in this report.",
    });
  }

  try {
    const profile = getIndustryProfile();
    const payload = buildManagerSummaryPayload(report, failedItems, profile);
    const ai = await callAiProviderWithPayload(payload);
    const summary = normalizeManagerSummary(report, failedItems, ai.result, profile);

    return res.json({
      provider: ai.provider,
      industry: profile.industry,
      ...summary,
    });
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Manager summary could not be generated",
    });
  }
});

module.exports = router;
