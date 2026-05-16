const express = require("express");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_AZURE_API_VERSION = "2024-10-21";

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

async function callAiProvider(report, failedItems, profile) {
  const azureResult = await callAzureOpenAi(report, failedItems, profile);
  if (azureResult) return { provider: "azure-openai", result: azureResult };

  const openAiResult = await callOpenAi(report, failedItems, profile);
  if (openAiResult) return { provider: "openai", result: openAiResult };

  return { provider: "fallback", result: null };
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

module.exports = router;
