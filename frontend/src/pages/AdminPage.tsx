import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AnswerType,
  AppMessage,
  Assignment,
  BillingCycle,
  BillingSummary,
  Checklist,
  Organization,
  Report,
  ManagerSummaryResponse,
  User,
  Walkthrough,
  WalkthroughSection,
} from "../types";
import { styles } from "../styles/appStyles";
import DashboardShell from "../components/DashboardShell";
import PasswordInput from "../components/PasswordInput";
import ReportDetail from "../components/ReportDetail";
import ReportEmailDialog from "../components/ReportEmailDialog";
import ManagerSummaryPanel from "../components/ManagerSummaryPanel";
import WalkthroughDetail from "../components/WalkthroughDetail";
import { createAssignment, getAssignments, startTemplate } from "../services/assignmentService";
import {
  createChecklist,
  updateChecklist,
  deleteChecklist,
  forceDeleteChecklist,
  getCommunityTemplates,
  getChecklists,
  importCommunityTemplate,
  previewChecklistImport,
  shareChecklist,
  shareChecklistWithCommunity,
} from "../services/checklistService";
import {
  deleteReport,
  getReports,
  getUnreadReportCount,
  markReportsRead,
} from "../services/reportService";
import {
  createWalkthrough,
  deleteWalkthrough,
  getWalkthroughs,
  updateWalkthrough,
} from "../services/walkthroughService";
import {
  createPasswordResetLink,
  createTemporaryPassword,
  createUser,
  deleteUser,
  getUsers,
  updateUser,
} from "../services/userService";
import {
  createOrganization,
  deleteOrganization,
  getOrganizations,
  updateOrganization,
} from "../services/organizationService";
import {
  emailReport,
  getReportEmailRecipients,
  ReportEmailRecipient,
} from "../services/emailService";
import {
  cancelCurrentSubscription,
  cancelSubscription,
  createSubscription,
  getBillingSummary,
  initializeIyzicoCheckout,
} from "../services/billingService";
import { generateChecklistPdf } from "../utils/generateChecklistPdf";
import {
  generateManagerSummary,
  getActionPlanExcelDownloadUrl,
  getReportFailedItems,
} from "../services/aiActionPlanService";
import {
  apiPost,
  createServerDownload,
  resolveFileUrl,
  uploadPhotos,
} from "../services/api";
import {
  deleteDraft,
  getDraft,
  saveDraft,
  saveDraftKeepalive,
} from "../services/draftService";
import {
  createDownloadFromUrl,
  GeneratedDownload,
  openDownload,
  revokeDownload,
} from "../utils/downloadFile";
import {
  getMessages,
  importTemplateFromMessage,
  markMessageRead,
  sendAppMessage,
} from "../services/messageService";

const AUTO_LOGOFF_SAVE_EVENT = "inspectria:auto-logoff-save";
const LIST_PAGE_SIZE = 10;

type Props = {
  user: User;
  onLogout: () => Promise<void>;
  initialSection?: AdminSectionKey;
};

type ReportEmailTarget =
  | { type: "checklist"; report: Report }
  | { type: "walkthrough"; walkthrough: Walkthrough };

type SectionForm = {
  title: string;
  items: QuestionForm[];
};

type QuestionForm = {
  question: string;
  answerType: AnswerType;
  options: string[];
};

type FillItem = {
  itemId: number;
  sectionTitle?: string;
  question: string;
  answerType: AnswerType;
  options?: string[];
  answer: string;
  comment: string;
  photos: string[];
  touchedAt?: string;
};

type TemplateDraft = {
  editingId: number | null;
  title: string;
  templateImagePath: string;
  sections: SectionForm[];
  savedAt: string;
};

type AdminSectionKey =
  | "dashboard"
  | "organizations"
  | "organizationUsers"
  | "billing"
  | "messages"
  | "templates"
  | "communityTemplates"
  | "myWork"
  | "assignments"
  | "walkthroughs"
  | "users"
  | "reports"
  | "support"
  | "account";

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  FORMAT1: "Yes / No / N/A",
  DATE: "Date",
  TEXT: "Text",
  MULTIPLE_CHOICE: "Dropdown",
  RADIO_BUTTON: "Check Box",
};

function getAnswerButtonStyle(
  option: "YES" | "NO" | "N/A",
  selected: string
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#092934",
    cursor: "pointer",
    fontWeight: 700,
    minWidth: 72,
    transition: "all 0.15s ease",
  };

  if (selected !== option) return base;

  if (option === "YES") {
    return {
      ...base,
      background: "#16a34a",
      color: "#ffffff",
      border: "1px solid #16a34a",
    };
  }

  if (option === "NO") {
    return {
      ...base,
      background: "#dc2626",
      color: "#ffffff",
      border: "1px solid #dc2626",
    };
  }

  return {
    ...base,
    background: "#0f766e",
    color: "#ffffff",
    border: "1px solid #0f766e",
  };
}

const ALLOWED_IMPORT_EXTENSIONS = new Set([".xlsx", ".csv"]);
const IMPORT_ANSWER_TYPES = new Set<AnswerType>([
  "FORMAT1",
  "DATE",
  "TEXT",
  "MULTIPLE_CHOICE",
  "RADIO_BUTTON",
]);

const ADMIN_SECTIONS: Array<{
  key: AdminSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Organization overview and success metrics",
  },
  {
    key: "users",
    label: "User Management",
    description: "Approve, create, and edit users",
  },
  {
    key: "templates",
    label: "Templates",
    description: "Create and manage checklist templates",
  },
  {
    key: "communityTemplates",
    label: "Community Templates",
    description: "Use templates shared by the Inspectria community",
  },
  {
    key: "assignments",
    label: "Assignments",
    description: "Assign checklist work to users",
  },
  {
    key: "reports",
    label: "Completed Reports",
    description: "Review reports and export files",
  },
  {
    key: "walkthroughs",
    label: "Walkthrough",
    description: "Prepare on-the-go inspection lists",
  },
  {
    key: "myWork",
    label: "My Work",
    description: "Fill assigned or organization templates",
  },
  {
    key: "messages",
    label: "Messages",
    description: "Template shares and inbox",
  },
  {
    key: "account",
    label: "My Account",
    description: "Change your password",
  },
  {
    key: "billing",
    label: "Billing",
    description: "Manage plans and subscriptions",
  },
  {
    key: "support",
    label: "Support",
    description: "Role guide and support tickets",
  },
  {
    key: "organizations",
    label: "Organizations",
    description: "Manage SaaS tenants and admins",
  },
  {
    key: "organizationUsers",
    label: "User List",
    description: "List organization users and email addresses",
  },
];

const PLATFORM_ADMIN_SECTION_KEYS: AdminSectionKey[] = [
  "organizations",
  "organizationUsers",
  "users",
  "templates",
  "communityTemplates",
  "assignments",
  "reports",
  "walkthroughs",
  "messages",
  "account",
  "billing",
];

function createEmptyQuestion(): QuestionForm {
  return {
    question: "",
    answerType: "FORMAT1",
    options: [""],
  };
}

function normalizeQuestionForm(item: {
  question?: string;
  answerType?: AnswerType;
  answer_type?: AnswerType;
  options?: string[];
}): QuestionForm {
  return {
    question: item.question || "",
    answerType: item.answerType || item.answer_type || "FORMAT1",
    options: item.options?.length ? item.options : [""],
  };
}

function normalizeDraftSections(value: unknown): SectionForm[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((section) => {
      if (!section || typeof section !== "object") return null;
      const source = section as { title?: unknown; items?: unknown };
      const items = Array.isArray(source.items)
        ? source.items
            .filter((item): item is Parameters<typeof normalizeQuestionForm>[0] =>
              Boolean(item && typeof item === "object")
            )
            .map(normalizeQuestionForm)
        : [];

      return {
        title: typeof source.title === "string" ? source.title : "",
        items: items.length ? items : [createEmptyQuestion()],
      };
    })
    .filter((section): section is SectionForm => Boolean(section));
}

function normalizeImportRows(rows: unknown[][]) {
  return rows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some(Boolean));
}

function normalizeImportHeader(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function findImportHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header === candidate || header.includes(candidate))
  );
}

function importRowLooksLikeHeader(row: string[]) {
  const headers = row.map(normalizeImportHeader);
  return (
    findImportHeaderIndex(headers, ["section", "bölüm", "bolum", "kategori", "alan"]) >= 0 ||
    findImportHeaderIndex(headers, ["question", "soru", "criteria", "kriter", "kontrol"]) >= 0 ||
    findImportHeaderIndex(headers, ["standard", "standart", "limit"]) >= 0
  );
}

function buildImportedQuestion(question: string, standard: string) {
  const cleanQuestion = question.trim();
  const cleanStandard = standard.trim();
  if (!cleanQuestion) return "";
  if (!cleanStandard || cleanQuestion.includes(cleanStandard)) return cleanQuestion;
  return `${cleanQuestion} (Standart: ${cleanStandard})`;
}

function normalizeImportAnswerType(value: string): AnswerType {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^YES_?\/_?NO_?\/_?N\/?A$/, "FORMAT1")
    .replace(/^YES_?NO_?N\/?A$/, "FORMAT1")
    .replace(/^YES_NO_NA$/, "FORMAT1")
    .replace(/^YES_NO_N\/A$/, "FORMAT1");

  return IMPORT_ANSWER_TYPES.has(normalized as AnswerType)
    ? (normalized as AnswerType)
    : "FORMAT1";
}

function looksLikeAnswerType(value: string) {
  return normalizeImportAnswerType(value) !== "FORMAT1" || /^format\s*1$/i.test(value.trim());
}

function buildLocalImportSections(rows: string[][]): SectionForm[] {
  if (rows.length === 0) return [];

  const hasHeader = importRowLooksLikeHeader(rows[0]);
  const headers = hasHeader ? rows[0].map(normalizeImportHeader) : [];
  const sourceRows = hasHeader ? rows.slice(1) : rows;
  const hasMultiColumnRows = sourceRows.some((row) => row[0] && row[1]);
  const secondColumnLooksLikeAnswerType = sourceRows.some((row) => looksLikeAnswerType(row[1] || ""));
  const sectionIndex = hasHeader
    ? findImportHeaderIndex(headers, ["section", "bölüm", "bolum", "kategori", "alan"])
    : hasMultiColumnRows && !secondColumnLooksLikeAnswerType
      ? 0
      : -1;
  const questionIndex = hasHeader
    ? findImportHeaderIndex(headers, ["question", "questions", "soru", "criteria", "kriter", "kontrol"])
    : hasMultiColumnRows
      ? secondColumnLooksLikeAnswerType
        ? 0
        : 1
      : 0;
  const answerTypeIndex = hasHeader
    ? findImportHeaderIndex(headers, ["answer type", "answer format", "type", "format", "yanıt tipi", "yanit tipi"])
    : secondColumnLooksLikeAnswerType
      ? 1
      : sourceRows.some((row) => looksLikeAnswerType(row[2] || ""))
        ? 2
        : -1;
  const standardIndex = hasHeader
    ? findImportHeaderIndex(headers, ["standard", "standart", "limit", "expected", "beklenen"])
    : answerTypeIndex < 0 && sourceRows.some((row) => row[2])
      ? 2
      : -1;
  const sections: SectionForm[] = [];
  const sectionMap = new Map<string, SectionForm>();
  let currentSectionTitle = "Imported Questions";

  function ensureSection(title: string) {
    const cleanTitle = title.trim() || "Imported Questions";
    const key = cleanTitle.toLocaleLowerCase("tr-TR");
    const existing = sectionMap.get(key);
    if (existing) return existing;

    const section: SectionForm = { title: cleanTitle, items: [] };
    sectionMap.set(key, section);
    sections.push(section);
    return section;
  }

  sourceRows.forEach((row) => {
    const filledCells = row.filter(Boolean);
    if (filledCells.length === 0) return;

    const explicitSection = sectionIndex >= 0 ? String(row[sectionIndex] || "").trim() : "";
    const rawQuestion = questionIndex >= 0 ? String(row[questionIndex] || "").trim() : "";
    const rawAnswerType = answerTypeIndex >= 0 ? String(row[answerTypeIndex] || "").trim() : "";
    const rawStandard = standardIndex >= 0 ? String(row[standardIndex] || "").trim() : "";

    if (!rawQuestion && filledCells.length === 1) {
      currentSectionTitle = filledCells[0];
      ensureSection(currentSectionTitle);
      return;
    }

    const question = buildImportedQuestion(rawQuestion || filledCells[0], rawStandard);
    if (!question) return;

    ensureSection(explicitSection || currentSectionTitle).items.push({
      question,
      answerType: normalizeImportAnswerType(rawAnswerType),
      options: [""],
    });
  });

  return sections.filter((section) => section.items.length > 0);
}

function getFileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function getOrganizationLabel(organization: Organization | undefined, organizationId?: number | null) {
  if (organization) return organization.name;
  if (organizationId) return `Organization #${organizationId}`;
  return "No Organization";
}

function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatLimit(value: number, label: string) {
  return value < 0 ? `Unlimited ${label}` : `${value} ${label}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-US");
  } catch {
    return value;
  }
}

function getDaysBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null;
  return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
}

function normalizeAnswer(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

function ShowMoreButton({
  visibleCount,
  totalCount,
  onBack,
  onClick,
}: {
  visibleCount: number;
  totalCount: number;
  onBack: () => void;
  onClick: () => void;
}) {
  const canGoBack = visibleCount > LIST_PAGE_SIZE;
  const canShowMore = visibleCount < totalCount;
  if (!canGoBack && !canShowMore) return null;

  return (
    <div className="show-more-row">
      {canGoBack ? (
        <button type="button" style={styles.secondaryButton} onClick={onBack}>
          Go Back
        </button>
      ) : null}
      {canShowMore ? (
        <button type="button" style={styles.secondaryButton} onClick={onClick}>
          Show More
        </button>
      ) : null}
    </div>
  );
}

function isDesktopViewport() {
  return typeof window === "undefined"
    ? true
    : window.matchMedia("(min-width: 769px)").matches;
}

type UserGroup = {
  key: string;
  organizationId: number | null;
  organization?: Organization;
  name: string;
  users: User[];
};

function currentOrganizationUserGroup(users: User[]): UserGroup {
  return {
    key: "current",
    organizationId: null,
    organization: undefined,
    name: "",
    users,
  };
}

function groupUsersByOrganization(users: User[], organizations: Organization[]): UserGroup[] {
  const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));
  const grouped = new Map<string, UserGroup>();

  users.forEach((candidate) => {
    const organizationId = candidate.organizationId || null;
    const key = organizationId ? String(organizationId) : "none";
    const organization = organizationId ? organizationMap.get(organizationId) : undefined;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        organizationId,
        organization,
        name: getOrganizationLabel(organization, organizationId),
        users: [],
      });
    }

    grouped.get(key)?.users.push(candidate);
  });

  return Array.from(grouped.values()).sort((first, second) => {
    if (first.organizationId === null) return 1;
    if (second.organizationId === null) return -1;
    return first.name.localeCompare(second.name);
  });
}

function mapReportToPdfPayload(report: Report) {
  return {
    hotelName: report.checklistTitle,
    reportTitle: "Checklist Completion Report",
    checklistTitle: report.checklistTitle,
    assignedToName: report.assignedToName,
    assignedByName: report.assignedByName,
    completedByName: report.completedByName,
    completedAt: report.completed_at,
    status: report.status,
    items: (report.items || []).map((item) => ({
      title: item.question,
      question: item.question,
      answer: item.answer as "YES" | "NO" | "N/A" | "",
      answerType: item.answerType || item.answer_type || "FORMAT1",
      comment: item.comment || "",
      photos: item.photos || [],
      sectionTitle: item.sectionTitle || item.section_title || "",
    })),
  };
}

function mapWalkthroughToPdfPayload(walkthrough: Walkthrough) {
  return {
    hotelName: walkthrough.organizationName || "Inspectria",
    reportTitle: "Walkthrough Report",
    checklistTitle: walkthrough.title,
    assignedToName: walkthrough.location || "-",
    assignedByName: "On-the-go walkthrough",
    completedByName: walkthrough.createdByName || "-",
    completedAt: walkthrough.completed_at || walkthrough.updated_at,
    status: walkthrough.status,
    items: walkthrough.sections.flatMap((section, sectionIndex) =>
      section.items.map((item, itemIndex) => ({
        title: `${sectionIndex + 1}.${itemIndex + 1}. ${section.title}`,
        question: `${section.title} - Comment ${itemIndex + 1}`,
        answer: item.severity || "N/A",
        answerType: "TEXT" as const,
        comment: item.comment || "",
        photos: item.photos || [],
      }))
    ),
  };
}

function findChecklistItemSectionIndex(checklist: Checklist, itemId: number) {
  return checklist.sections.findIndex((section) =>
    section.items.some((item) => item.id === itemId)
  );
}

function findResumeItemId(checklist: Checklist, form: Record<number, FillItem>) {
  const orderedItemIds = checklist.sections.flatMap((section) =>
    section.items.map((item) => item.id)
  );
  let newestTouchedItemId: number | null = null;
  let newestTouchedAt = 0;
  let lastAnsweredItemId: number | null = null;

  orderedItemIds.forEach((itemId) => {
    const draftItem = form[itemId];
    if (!draftItem) return;

    if ((draftItem.answer || "").trim()) {
      lastAnsweredItemId = itemId;
    }

    const touchedAt = draftItem.touchedAt ? new Date(draftItem.touchedAt).getTime() : 0;
    if (Number.isFinite(touchedAt) && touchedAt > newestTouchedAt) {
      newestTouchedAt = touchedAt;
      newestTouchedItemId = itemId;
    }
  });

  return newestTouchedItemId || lastAnsweredItemId;
}

function IyzicoCheckout({ content }: { content: string }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = content;
    const scripts = Array.from(container.querySelectorAll("script"));
    scripts.forEach((script) => {
      const nextScript = document.createElement("script");
      Array.from(script.attributes).forEach((attribute) => {
        nextScript.setAttribute(attribute.name, attribute.value);
      });
      nextScript.text = script.text;
      script.replaceWith(nextScript);
    });
  }, [content]);

  return <div ref={containerRef} />;
}

export default function AdminPage({ user, onLogout, initialSection }: Props) {
  const isPlatformAdmin = user.role === "platform_admin";
  const normalizedInitialSection =
    isPlatformAdmin &&
    (!initialSection ||
      initialSection === "dashboard" ||
      initialSection === "myWork" ||
      initialSection === "support")
      ? "organizations"
      : initialSection;
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [activeAdminPage, setActiveAdminPage] = useState<AdminSectionKey>(
    normalizedInitialSection || (isPlatformAdmin ? "organizations" : isDesktopViewport() ? "dashboard" : "templates")
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const ownOrganization = organizations.find(
    (organization) => organization.id === user.organizationId
  );
  const [users, setUsers] = useState<User[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [communityTemplates, setCommunityTemplates] = useState<Checklist[]>([]);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const unreadMessageCount = messages.filter((candidate) => !candidate.readAt).length;
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<number, boolean>>({});
  const [composeMessageTitle, setComposeMessageTitle] = useState("");
  const [composeMessageBody, setComposeMessageBody] = useState("");
  const [selectedMessageRecipientIds, setSelectedMessageRecipientIds] = useState<number[]>([]);
  const [messageSending, setMessageSending] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [unreadReportCount, setUnreadReportCount] = useState(0);
  const [reportEmailRecipients, setReportEmailRecipients] = useState<ReportEmailRecipient[]>([]);
  const [reportEmailTarget, setReportEmailTarget] = useState<ReportEmailTarget | null>(null);
  const [reportEmailSending, setReportEmailSending] = useState(false);
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<Walkthrough | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [visibleListCounts, setVisibleListCounts] = useState<Record<string, number>>({});
  const [walkthroughTitle, setWalkthroughTitle] = useState("");
  const [walkthroughLocation, setWalkthroughLocation] = useState("");
  const [walkthroughSections, setWalkthroughSections] = useState<WalkthroughSection[]>([
    { title: "General", items: [{ comment: "", severity: "", photos: [] }] },
  ]);
  const [editingWalkthroughId, setEditingWalkthroughId] = useState<number | null>(null);
  const [walkthroughUploadingKey, setWalkthroughUploadingKey] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [templateImagePath, setTemplateImagePath] = useState("");
  const [templateImageLoadError, setTemplateImageLoadError] = useState(false);
  const [templateImageUploading, setTemplateImageUploading] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [sections, setSections] = useState<SectionForm[]>([
    {
      title: "",
      items: [createEmptyQuestion()],
    },
  ]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [shareForms, setShareForms] = useState<Record<number, { open: boolean; email: string; sending: boolean }>>({});
  const [draggedQuestion, setDraggedQuestion] = useState<{
    sectionIndex: number;
    questionIndex: number;
  } | null>(null);

  const [selectedChecklistId, setSelectedChecklistId] = useState<number>(0);
  const [selectedUserId, setSelectedUserId] = useState<number>(0);
  const [activeAssignmentId, setActiveAssignmentId] = useState<number | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<number, FillItem>>({});
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [managerSummaryReportId, setManagerSummaryReportId] = useState<number | null>(null);
  const [generatedDownload, setGeneratedDownload] = useState<GeneratedDownload | null>(null);
  const [managerSummaryPreview, setManagerSummaryPreview] = useState<{
    report: Report;
    summary: ManagerSummaryResponse;
  } | null>(null);
  const localDraftKey = `mod_draft_${user.id}`;
  const templateDraftKey = `inspectria_template_draft_${user.id}`;
  const activeAssignmentIdRef = useRef<number | null>(null);
  const latestFormRef = useRef<Record<number, FillItem>>({});
  const saveTimeoutRef = useRef<number | null>(null);
  const questionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [resumeItemId, setResumeItemId] = useState<number | null>(null);

  useEffect(() => {
    setTemplateImageLoadError(false);
  }, [templateImagePath]);

  const hasTemplateDraftContent = (draft: Omit<TemplateDraft, "savedAt">) =>
    Boolean(
      draft.title.trim() ||
      draft.templateImagePath ||
      draft.sections.some(
        (section) =>
          section.title.trim() ||
          section.items.some(
            (item) =>
              item.question.trim() ||
              item.answerType !== "FORMAT1" ||
              item.options.some((option) => option.trim())
          )
      )
    );

  const clearTemplateDraft = () => {
    localStorage.removeItem(templateDraftKey);
  };

  const saveTemplateDraft = () => {
    const draft = {
      editingId,
      title,
      templateImagePath,
      sections,
    };

    if (!hasTemplateDraftContent(draft)) {
      clearTemplateDraft();
      return;
    }

    localStorage.setItem(
      templateDraftKey,
      JSON.stringify({
        ...draft,
        savedAt: new Date().toISOString(),
      } satisfies TemplateDraft)
    );
  };

  const restoreTemplateDraft = () => {
    const rawDraft = localStorage.getItem(templateDraftKey);
    if (!rawDraft) return;

    try {
      const parsed = JSON.parse(rawDraft) as Partial<TemplateDraft>;
      const restored = {
        editingId: typeof parsed.editingId === "number" ? parsed.editingId : null,
        title: typeof parsed.title === "string" ? parsed.title : "",
        templateImagePath:
          typeof parsed.templateImagePath === "string" ? parsed.templateImagePath : "",
        sections: normalizeDraftSections(parsed.sections),
      };

      if (!restored.sections.length) {
        restored.sections = [{ title: "", items: [createEmptyQuestion()] }];
      }

      if (!hasTemplateDraftContent(restored)) {
        clearTemplateDraft();
        return;
      }

      setEditingId(restored.editingId);
      setTitle(restored.title);
      setTemplateImagePath(restored.templateImagePath);
      setSections(restored.sections);
      setActiveAdminPage("templates");
      setMessage("Template draft restored from auto logoff. Continue editing and save when ready.");
    } catch {
      clearTemplateDraft();
    }
  };

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgPlan, setNewOrgPlan] = useState("standard");
  const [newOrgParentOrganizationId, setNewOrgParentOrganizationId] = useState<number>(0);
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState("");
  const [newOrgAdminUsername, setNewOrgAdminUsername] = useState("");
  const [newOrgAdminPassword, setNewOrgAdminPassword] = useState("");
  const [newOrgAdminName, setNewOrgAdminName] = useState("");
  const [billing, setBilling] = useState<BillingSummary>({
    plans: [],
    currentSubscription: null,
    subscriptions: [],
    usage: null,
  });
  const [billingOrganizationId, setBillingOrganizationId] = useState(0);
  const [billingPlanId, setBillingPlanId] = useState(0);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [billingPaymentMethod, setBillingPaymentMethod] = useState("Manual invoice");
  const [billingExternalCustomerId, setBillingExternalCustomerId] = useState("");
  const [billingExternalSubscriptionId, setBillingExternalSubscriptionId] = useState("");
  const [iyzicoCheckoutContent, setIyzicoCheckoutContent] = useState("");
  const [iyzicoCheckoutToken, setIyzicoCheckoutToken] = useState("");
  const currentPlanCode = String(
    billing.currentSubscription?.planCode || ownOrganization?.plan || ""
  ).toLowerCase();
  const isTopLevelTenant = Boolean(ownOrganization && !ownOrganization.parentOrganizationId);
  const subOrganizations = organizations.filter(
    (organization) => organization.parentOrganizationId === user.organizationId
  );
  const canCreateSubOrganizations =
    isPlatformAdmin || (isTopLevelTenant && currentPlanCode === "enterprise");
  const canViewSubOrganizations =
    isPlatformAdmin || canCreateSubOrganizations || subOrganizations.length > 0;
  const visibleAdminSections = isPlatformAdmin
    ? PLATFORM_ADMIN_SECTION_KEYS.map((key) =>
        ADMIN_SECTIONS.find((section) => section.key === key)
      ).filter((section): section is (typeof ADMIN_SECTIONS)[number] => Boolean(section))
    : ADMIN_SECTIONS.filter(
        (section) =>
          section.key !== "organizationUsers" &&
          (canViewSubOrganizations || section.key !== "organizations") &&
          (isDesktop || section.key !== "dashboard")
      );

  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [newUserOrganizationId, setNewUserOrganizationId] = useState<number>(0);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [passwordResetLinks, setPasswordResetLinks] = useState<Record<number, string>>({});
  const [passwordResetLinkLoadingId, setPasswordResetLinkLoadingId] = useState<number | null>(null);
  const [temporaryPasswords, setTemporaryPasswords] = useState<Record<number, string>>({});
  const [temporaryPasswordLoadingId, setTemporaryPasswordLoadingId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState("");
  const [pendingUserForms, setPendingUserForms] = useState<
    Record<number, { username: string; name: string; email: string }>
  >({});
  const pendingUsers = users.filter((u) => u.approvalStatus === "pending");
  const approvedUsers = users.filter(
    (u) => u.approvalStatus !== "pending" && u.role !== "platform_admin"
  );
  const pendingUserGroups = groupUsersByOrganization(pendingUsers, organizations);
  const approvedUserGroups = groupUsersByOrganization(approvedUsers, organizations);
  const messageRecipients = approvedUsers.filter(
    (candidate) =>
      candidate.active !== false &&
      candidate.approvalStatus !== "rejected" &&
      (candidate.role === "admin" || candidate.role === "user")
  );
  const fallbackReportEmailRecipients: ReportEmailRecipient[] = messageRecipients
    .filter((candidate) => Boolean(candidate.email))
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      username: candidate.username,
      email: candidate.email,
      role: candidate.role === "admin" ? "admin" : "user",
      organizationName: candidate.organizationName,
    }));
  const availableReportEmailRecipients =
    reportEmailRecipients.length > 0
      ? reportEmailRecipients
      : fallbackReportEmailRecipients;
  const selectedMessageRecipientSet = new Set(selectedMessageRecipientIds);
  const allMessageRecipientsSelected =
    messageRecipients.length > 0 &&
    messageRecipients.every((candidate) => selectedMessageRecipientSet.has(candidate.id));
  const activeAssignment =
    assignments.find((assignment) => assignment.id === activeAssignmentId) || null;
  const activeChecklist = useMemo(() => {
    if (!activeAssignment) return null;
    return checklists.find((checklist) => checklist.id === activeAssignment.checklist_id) || null;
  }, [activeAssignment, checklists]);
  const checklistProgress = useMemo(() => {
    const items = activeChecklist?.sections.flatMap((section) => section.items) || [];
    const total = items.length;
    const answered = items.filter((item) => (form[item.id]?.answer || "").trim()).length;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

    return { answered, total, percent };
  }, [activeChecklist, form]);
  const activeSectionProgress = useMemo(() => {
    const items = activeChecklist?.sections[activeSectionIndex]?.items || [];
    const total = items.length;
    const answered = items.filter((item) => (form[item.id]?.answer || "").trim()).length;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

    return { answered, total, percent };
  }, [activeChecklist, activeSectionIndex, form]);
  const activeSection = activeChecklist?.sections[activeSectionIndex] || null;
  const sectionCount = activeChecklist?.sections.length || 0;
  const isFirstSection = activeSectionIndex === 0;
  const isLastSection = activeSectionIndex >= sectionCount - 1;
  const myActiveAssignments = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" && assignment.assigned_to_user_id === user.id
  );
  const myAssignedAssignments = myActiveAssignments.filter(
    (assignment) => !assignment.isSelfStarted
  );
  const selfStartedChecklistIds = new Set(
    myActiveAssignments
      .filter((assignment) => assignment.isSelfStarted)
      .map((assignment) => assignment.checklist_id)
  );

  function readLocalDrafts() {
    const raw = localStorage.getItem(localDraftKey);
    if (!raw) return {} as Record<string, { form: Record<number, FillItem>; updatedAt: string }>;

    try {
      return JSON.parse(raw) as Record<
        string,
        { form: Record<number, FillItem>; updatedAt: string }
      >;
    } catch {
      return {};
    }
  }

  function writeLocalDraft(assignmentId: number, nextForm: Record<number, FillItem>) {
    const drafts = readLocalDrafts();
    drafts[String(assignmentId)] = {
      form: nextForm,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(localDraftKey, JSON.stringify(drafts));
  }

  function removeLocalDraft(assignmentId: number) {
    const drafts = readLocalDrafts();
    delete drafts[String(assignmentId)];
    localStorage.setItem(localDraftKey, JSON.stringify(drafts));
  }

  function scheduleRemoteDraftSave(
    assignmentId: number,
    nextForm: Record<number, FillItem>
  ) {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveDraft(assignmentId, nextForm).catch((saveError) => {
        console.error(saveError);
      });
    }, 400);
  }

  function persistDraft(
    assignmentId: number,
    nextForm: Record<number, FillItem>,
    options?: { immediateRemote?: boolean }
  ) {
    latestFormRef.current = nextForm;
    writeLocalDraft(assignmentId, nextForm);

    if (options?.immediateRemote) {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      saveDraftKeepalive(assignmentId, nextForm);
      return;
    }

    scheduleRemoteDraftSave(assignmentId, nextForm);
  }

  const load = async () => {
    const [
      orgs,
      u,
      c,
      community,
      a,
      r,
      w,
      billingSummary,
      inbox,
      emailRecipients,
      unreadReports,
    ] = await Promise.all([
      getOrganizations(),
      getUsers(),
      getChecklists(),
      getCommunityTemplates(),
      getAssignments(),
      getReports(),
      getWalkthroughs(),
      getBillingSummary(),
      getMessages(),
      getReportEmailRecipients().catch(() => []),
      getUnreadReportCount().catch(() => ({ count: 0 })),
    ]);

    setOrganizations(orgs);
    setUsers(u);
    setChecklists(c);
    setCommunityTemplates(community);
    setMessages(inbox.messages);
    setAssignments(a);
    setReports(r);
    setUnreadReportCount(Number(unreadReports.count || 0));
    setReportEmailRecipients(emailRecipients);
    setWalkthroughs(w);
    setBilling(billingSummary);
    setPendingUserForms((prev) => {
      const next = { ...prev };

      u.filter((candidate) => candidate.approvalStatus === "pending").forEach((candidate) => {
        next[candidate.id] = next[candidate.id] || {
          username: candidate.username,
          name: candidate.name,
          email: candidate.email || "",
        };
      });

      Object.keys(next).forEach((key) => {
        const pendingExists = u.some(
          (candidate) =>
            candidate.id === Number(key) && candidate.approvalStatus === "pending"
        );

        if (!pendingExists) {
          delete next[Number(key)];
        }
      });

      return next;
    });

    if (!selectedChecklistId && c[0]) {
      setSelectedChecklistId(c[0].id);
    }

    const assignableUsers = u.filter(
      (x) =>
        (x.role === "user" || x.id === user.id) &&
        x.active !== false &&
        x.approvalStatus !== "pending"
    );
    if (!selectedUserId && assignableUsers[0]) {
      setSelectedUserId(assignableUsers[0].id);
    }

    if (isPlatformAdmin && !billingOrganizationId && orgs[0]) {
      setBillingOrganizationId(orgs[0].id);
    }

    if (!newOrgParentOrganizationId) {
      const ownOrganization = orgs.find((organization) => organization.id === user.organizationId);
      if (ownOrganization) setNewOrgParentOrganizationId(ownOrganization.id);
    }

    if (!newUserOrganizationId) {
      const ownOrganization = orgs.find((organization) => organization.id === user.organizationId);
      if (ownOrganization) setNewUserOrganizationId(ownOrganization.id);
      else if (orgs[0]) setNewUserOrganizationId(orgs[0].id);
    }

    if (!billingPlanId) {
      const currentPlanId = billingSummary.currentSubscription?.billingPlanId;
      if (currentPlanId) setBillingPlanId(currentPlanId);
      else if (billingSummary.plans[0]) setBillingPlanId(billingSummary.plans[0].id);
    }

    if (billingSummary.currentSubscription?.billingCycle) {
      setBillingCycle(billingSummary.currentSubscription.billingCycle);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    activeAssignmentIdRef.current = activeAssignmentId;
  }, [activeAssignmentId]);

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  useEffect(() => {
    if (!activeChecklist) {
      setActiveSectionIndex(0);
      return;
    }

    setActiveSectionIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(activeChecklist.sections.length - 1, 0))
    );
  }, [activeChecklist]);

  useEffect(() => {
    if (!resumeItemId || !activeSection?.items.some((item) => item.id === resumeItemId)) return;

    window.requestAnimationFrame(() => {
      questionRefs.current[resumeItemId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setResumeItemId(null);
    });
  }, [activeSection, resumeItemId]);

  useEffect(() => {
    restoreTemplateDraft();
  }, []);

  useEffect(() => {
    window.addEventListener(AUTO_LOGOFF_SAVE_EVENT, saveTemplateDraft);
    return () => window.removeEventListener(AUTO_LOGOFF_SAVE_EVENT, saveTemplateDraft);
  }, [editingId, title, templateImagePath, sections]);

  useEffect(() => {
    const flushDraft = () => {
      if (isRestoringDraft) return;

      const assignmentId = activeAssignmentIdRef.current;
      if (!assignmentId) return;

      persistDraft(assignmentId, latestFormRef.current, { immediateRemote: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushDraft();
      }
    };

    window.addEventListener("pagehide", flushDraft);
    window.addEventListener("beforeunload", flushDraft);
    window.addEventListener(AUTO_LOGOFF_SAVE_EVENT, flushDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushDraft);
      window.removeEventListener("beforeunload", flushDraft);
      window.removeEventListener(AUTO_LOGOFF_SAVE_EVENT, flushDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isRestoringDraft]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 769px)");
    const syncDesktopState = () => {
      setIsDesktop(mediaQuery.matches);
      if (mediaQuery.matches) setIsMobileNavigationOpen(false);
    };

    syncDesktopState();
    mediaQuery.addEventListener("change", syncDesktopState);
    return () => mediaQuery.removeEventListener("change", syncDesktopState);
  }, []);

  useEffect(() => {
    if (
      isPlatformAdmin &&
      (activeAdminPage === "dashboard" ||
        activeAdminPage === "myWork" ||
        activeAdminPage === "support")
    ) {
      setActiveAdminPage("organizations");
      return;
    }

    if (!isPlatformAdmin && !isDesktop && activeAdminPage === "dashboard") {
      setActiveAdminPage("templates");
    }
  }, [activeAdminPage, isDesktop, isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin && activeAdminPage === "organizations" && !canViewSubOrganizations) {
      setActiveAdminPage("users");
    }
  }, [activeAdminPage, canViewSubOrganizations, isPlatformAdmin]);

  useEffect(() => {
    if (activeAdminPage !== "reports" || unreadReportCount === 0) return;

    setUnreadReportCount(0);
    markReportsRead().catch(() => null);
  }, [activeAdminPage, unreadReportCount]);

  useEffect(() => {
    return () => {
      revokeDownload(generatedDownload);
    };
  }, [generatedDownload]);

  const publishGeneratedDownload = async (
    blob: Blob,
    fileName: string,
    label: string,
    mimeType: string
  ) => {
    const serverDownload = await createServerDownload(blob, fileName, mimeType);
    const isPdf = mimeType === "application/pdf";
    const download = createDownloadFromUrl(
      isPdf ? `${serverDownload.url}?view=1` : serverDownload.url,
      serverDownload.fileName,
      label,
      isPdf
    );
    setGeneratedDownload((previous) => {
      revokeDownload(previous);
      return download;
    });
    openDownload(download);
  };

  const openAssignment = async (assignment: Assignment) => {
    const checklist = checklists.find((candidate) => candidate.id === assignment.checklist_id);
    if (!checklist) return;

    const initial: Record<number, FillItem> = {};

    checklist.sections.forEach((section) => {
      section.items.forEach((item) => {
        initial[item.id] = {
          itemId: item.id,
          sectionTitle: section.title,
          question: item.question,
          answerType: item.answerType || item.answer_type || "FORMAT1",
          options: item.options || [],
          answer: "",
          comment: "",
          photos: [],
        };
      });
    });

    setIsRestoringDraft(true);
    setSelectedReport(null);
    setActiveAssignmentId(assignment.id);
    setActiveAdminPage("myWork");
    setActiveSectionIndex(0);

    let merged = initial;
    const localDrafts = readLocalDrafts();
    const localDraft = localDrafts[String(assignment.id)];

    try {
      const response = await getDraft(assignment.id);
      const remoteDraft = response.draft;

      const newestDraft =
        remoteDraft && localDraft
          ? new Date(remoteDraft.updatedAt).getTime() >=
            new Date(localDraft.updatedAt).getTime()
            ? remoteDraft
            : localDraft
          : remoteDraft || localDraft;

      if (newestDraft?.form) {
        merged = Object.fromEntries(
          Object.entries(initial).map(([itemId, initialItem]) => [
            itemId,
            {
              ...initialItem,
              ...(newestDraft.form[Number(itemId)] || {}),
              answerType: initialItem.answerType,
              options: initialItem.options,
            },
          ])
        ) as Record<number, FillItem>;

        setMessage("Saved draft loaded. You can continue from where you left off.");
      } else {
        setMessage("");
      }
    } catch (draftError) {
      console.error(draftError);

      if (localDraft?.form) {
        merged = Object.fromEntries(
          Object.entries(initial).map(([itemId, initialItem]) => [
            itemId,
            {
              ...initialItem,
              ...(localDraft.form[Number(itemId)] || {}),
              answerType: initialItem.answerType,
              options: initialItem.options,
            },
          ])
        ) as Record<number, FillItem>;
        setMessage("Offline saved draft loaded.");
      }
    } finally {
      const resumeId = findResumeItemId(checklist, merged);
      const resumeSectionIndex = resumeId ? findChecklistItemSectionIndex(checklist, resumeId) : -1;

      setForm(merged);
      latestFormRef.current = merged;
      writeLocalDraft(assignment.id, merged);
      if (resumeSectionIndex >= 0) {
        setActiveSectionIndex(resumeSectionIndex);
        setResumeItemId(resumeId);
      }
      setIsRestoringDraft(false);
    }
  };

  const openTemplate = async (checklist: Checklist) => {
    try {
      setStartingTemplateId(checklist.id);
      const result = await startTemplate(checklist.id);
      const refreshedAssignments = await getAssignments();
      setAssignments(refreshedAssignments);

      const assignment = refreshedAssignments.find((item) => item.id === result.assignmentId);
      if (!assignment) throw new Error("Template assignment could not be opened.");

      await openAssignment(assignment);
      setMessage(
        result.reused
          ? "Existing template draft opened. You can continue from where you left off."
          : "Template opened. You can complete it now or save it as a draft."
      );
    } catch (templateError) {
      alert(templateError instanceof Error ? templateError.message : "Template could not be opened.");
    } finally {
      setStartingTemplateId(null);
    }
  };

  const handleAddPhotos = async (itemId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      setUploadingItemId(itemId);
      const uploaded = await uploadPhotos(files);

      setForm((prev) => {
        const nextForm = {
          ...prev,
          [itemId]: {
            ...prev[itemId],
            photos: [...(prev[itemId]?.photos || []), ...uploaded],
          },
        };

        if (activeAssignmentIdRef.current) {
          persistDraft(activeAssignmentIdRef.current, nextForm);
        }

        return nextForm;
      });
    } catch (photoError) {
      console.error(photoError);
      alert("Photo upload failed.");
    } finally {
      setUploadingItemId(null);
    }
  };

  const removePhoto = (itemId: number, photoIndex: number) => {
    setForm((prev) => {
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          photos: prev[itemId].photos.filter((_, index) => index !== photoIndex),
        },
      };

      if (activeAssignmentIdRef.current) {
        persistDraft(activeAssignmentIdRef.current, nextForm);
      }

      return nextForm;
    });
  };

  const updateAnswer = (itemId: number, answer: string) => {
    setForm((prev) => {
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          answer,
          touchedAt: new Date().toISOString(),
        },
      };

      if (activeAssignmentIdRef.current) {
        persistDraft(activeAssignmentIdRef.current, nextForm);
      }

      return nextForm;
    });
  };

  const updateComment = (itemId: number, comment: string) => {
    setForm((prev) => {
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          comment,
        },
      };

      if (activeAssignmentIdRef.current) {
        persistDraft(activeAssignmentIdRef.current, nextForm);
      }

      return nextForm;
    });
  };

  const toggleMultiAnswer = (itemId: number, option: string) => {
    setForm((prev) => {
      const currentAnswers = (prev[itemId]?.answer || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const hasOption = currentAnswers.includes(option);
      const nextAnswers = hasOption
        ? currentAnswers.filter((value) => value !== option)
        : [...currentAnswers, option];
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          answer: nextAnswers.join(", "),
          touchedAt: new Date().toISOString(),
        },
      };

      if (activeAssignmentIdRef.current) {
        persistDraft(activeAssignmentIdRef.current, nextForm);
      }

      return nextForm;
    });
  };

  const saveAndContinueLater = () => {
    if (!activeAssignment) return;

    persistDraft(activeAssignment.id, latestFormRef.current, {
      immediateRemote: true,
    });
    setActiveAssignmentId(null);
    setActiveSectionIndex(0);
    setMessage("Checklist draft saved. You can continue later.");
  };

  const submitChecklist = async () => {
    if (!activeChecklist || !activeAssignment) return;

    const items = activeChecklist.sections.flatMap((section) =>
      section.items.map((item) => ({
        ...form[item.id],
        sectionTitle: section.title,
        answerType: item.answerType || item.answer_type || "FORMAT1",
      }))
    );

    await apiPost("/reports", {
      assignmentId: activeAssignment.id,
      items,
    });

    await deleteDraft(activeAssignment.id).catch(() => null);
    removeLocalDraft(activeAssignment.id);

    setMessage("Checklist completed.");
    setActiveAssignmentId(null);
    setForm({});
    await load();
  };

  const goToSection = (nextIndex: number) => {
    setActiveSectionIndex(Math.max(0, Math.min(nextIndex, sectionCount - 1)));
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const resetTemplateForm = () => {
    clearTemplateDraft();
    setEditingId(null);
    setTitle("");
    setTemplateImagePath("");
    setSections([
      {
        title: "",
        items: [createEmptyQuestion()],
      },
    ]);
  };

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      {
        title: "",
        items: [createEmptyQuestion()],
      },
    ]);
  };

  const moveSection = (sectionIndex: number, direction: -1 | 1) => {
    setSections((prev) => moveItem(prev, sectionIndex, sectionIndex + direction));
  };

  const updateSectionTitle = (sectionIndex: number, value: string) => {
    setSections((prev) =>
      prev.map((section, index) =>
        index === sectionIndex ? { ...section, title: value } : section
      )
    );
  };

  const addQuestionToSection = (sectionIndex: number) => {
    setSections((prev) =>
      prev.map((section, index) =>
        index === sectionIndex
          ? { ...section, items: [...section.items, createEmptyQuestion()] }
          : section
      )
    );
  };

  const removeQuestionFromSection = (sectionIndex: number, questionIndex: number) => {
    setSections((prev) =>
      prev.map((section, index) => {
        if (index !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.filter((_, itemIndex) => itemIndex !== questionIndex),
        };
      })
    );
  };

  const moveQuestionToIndex = (
    sectionIndex: number,
    fromQuestionIndex: number,
    toQuestionIndex: number
  ) => {
    setSections((prev) =>
      prev.map((section, index) => {
        if (index !== sectionIndex) return section;

        return {
          ...section,
          items: moveItem(section.items, fromQuestionIndex, toQuestionIndex),
        };
      })
    );
  };

  const handleQuestionDrop = (sectionIndex: number, questionIndex: number) => {
    if (!draggedQuestion || draggedQuestion.sectionIndex !== sectionIndex) {
      setDraggedQuestion(null);
      return;
    }

    moveQuestionToIndex(sectionIndex, draggedQuestion.questionIndex, questionIndex);
    setDraggedQuestion(null);
  };

  const updateQuestion = (
    sectionIndex: number,
    questionIndex: number,
    value: string
  ) => {
    setSections((prev) =>
      prev.map((section, sIndex) => {
        if (sIndex !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.map((question, qIndex) =>
            qIndex === questionIndex ? { ...question, question: value } : question
          ),
        };
      })
    );
  };

  const updateQuestionAnswerType = (
    sectionIndex: number,
    questionIndex: number,
    answerType: AnswerType
  ) => {
    setSections((prev) =>
      prev.map((section, sIndex) => {
        if (sIndex !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.map((question, qIndex) =>
            qIndex === questionIndex
              ? {
                  ...question,
                  answerType,
                  options:
                    ["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(answerType)
                      ? question.options.length
                        ? question.options
                        : [""]
                      : [""],
                }
              : question
          ),
        };
      })
    );
  };

  const updateQuestionOption = (
    sectionIndex: number,
    questionIndex: number,
    optionIndex: number,
    value: string
  ) => {
    setSections((prev) =>
      prev.map((section, sIndex) => {
        if (sIndex !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.map((question, qIndex) =>
            qIndex === questionIndex
              ? {
                  ...question,
                  options: question.options.map((option, index) =>
                    index === optionIndex ? value : option
                  ),
                }
              : question
          ),
        };
      })
    );
  };

  const addQuestionOption = (sectionIndex: number, questionIndex: number) => {
    setSections((prev) =>
      prev.map((section, sIndex) => {
        if (sIndex !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.map((question, qIndex) =>
            qIndex === questionIndex
              ? { ...question, options: [...question.options, ""] }
              : question
          ),
        };
      })
    );
  };

  const removeQuestionOption = (
    sectionIndex: number,
    questionIndex: number,
    optionIndex: number
  ) => {
    setSections((prev) =>
      prev.map((section, sIndex) => {
        if (sIndex !== sectionIndex) return section;

        return {
          ...section,
          items: section.items.map((question, qIndex) =>
            qIndex === questionIndex
              ? {
                  ...question,
                  options: question.options.filter((_, index) => index !== optionIndex),
                }
              : question
          ),
        };
      })
    );
  };

  const startEditTemplate = (checklist: Checklist) => {
    setActiveAdminPage("templates");
    setEditingId(checklist.id);
    setTitle(checklist.title);
    setTemplateImagePath(checklist.image_path || checklist.imagePath || "");
    setSections(
      (checklist.sections || []).map((section) => ({
        title: section.title,
        items: (section.items || []).map(normalizeQuestionForm),
      }))
    );
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleTemplateImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      setTemplateImageUploading(true);
      const uploaded = await uploadPhotos(files);
      setTemplateImagePath(uploaded[0] || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template image could not be uploaded");
    } finally {
      setTemplateImageUploading(false);
    }
  };

  const handleImportQuestionsFromExcel = (file: File | null) => {
    if (!file) return;

    setMessage("");
    setError("");
    setPendingImportFile(file);
  };

  const cancelExcelImport = () => {
    setPendingImportFile(null);
  };

  const continueExcelImport = async () => {
    const file = pendingImportFile;
    if (!file) return;

    setMessage("");
    setError("");
    setPendingImportFile(null);

    try {
      const extension = getFileExtension(file.name);
      if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
        setError("Only .xlsx and .csv files are allowed. Macro-enabled or legacy Excel files are not supported.");
        return;
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        setError("Excel file does not contain a sheet.");
        return;
      }

      const rows = normalizeImportRows(XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[firstSheetName],
        { header: 1, blankrows: false }
      ));

      if (rows.length === 0) {
        setError("No importable rows found in the selected sheet.");
        return;
      }

      setMessage("AI is reviewing the checklist and building sections...");
      let importProvider = "local rules";
      let importWarnings: string[] = [];
      let importedTitle = file.name.replace(/\.(xlsx|csv)$/i, "") || "Imported Template";
      let importedSections: SectionForm[] = [];

      try {
        const preview = await previewChecklistImport({
          fileName: file.name,
          sheetName: firstSheetName,
          rows,
        });
        importProvider = preview.provider === "fallback" ? "local rules" : "AI review";
        importWarnings = preview.warnings || [];
        importedTitle = preview.title || importedTitle;
        importedSections = preview.sections
          .map((section) => ({
            title: section.title,
            items: section.items.map(normalizeQuestionForm),
          }))
          .filter((section) => section.title.trim() && section.items.length > 0);
      } catch (importError) {
        importedSections = buildLocalImportSections(rows);
        importWarnings = [
          importError instanceof Error
            ? `AI import review could not be reached: ${importError.message}`
            : "AI import review could not be reached.",
        ];
      }

      const importedQuestionCount = importedSections.reduce(
        (total, section) => total + section.items.length,
        0
      );

      if (importedSections.length === 0 || importedQuestionCount === 0) {
        setError("No checklist questions could be detected in this file.");
        return;
      }

      setEditingId(null);
      setTitle((currentTitle) => currentTitle || importedTitle);
      setSections(importedSections);
      setActiveAdminPage("templates");
      setMessage(
        `${importedQuestionCount} questions imported into ${importedSections.length} sections with ${importProvider}. Review sections and question types before saving.${
          importWarnings.length ? ` ${importWarnings.join(" ")}` : ""
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Excel import failed");
    }
  };

  const saveChecklist = async () => {
    setMessage("");
    setError("");

    const payload = {
      title: title.trim(),
      sections: sections
        .filter((section) => section.title.trim())
        .map((section) => ({
          title: section.title.trim(),
          items: section.items
            .map((item) => ({
              question: item.question.trim(),
              answerType: item.answerType,
              options:
                ["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(item.answerType)
                  ? item.options.map((option) => option.trim()).filter(Boolean)
                  : [],
            }))
            .filter((item) => item.question),
        }))
        .filter((section) => section.items.length > 0),
    };

    if (!payload.title || payload.sections.length === 0) {
      setError("Checklist title and at least one valid section are required.");
      return;
    }

    const hasChoiceWithoutOptions = payload.sections.some((section) =>
      section.items.some(
        (item) =>
          ["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(item.answerType) &&
          item.options.length === 0
      )
    );

    if (hasChoiceWithoutOptions) {
      setError("Dropdown and Check Box questions require at least one option.");
      return;
    }

    try {
      if (editingId) {
        await updateChecklist(editingId, payload.title, templateImagePath, payload.sections);
        setMessage("Checklist updated.");
      } else {
        await createChecklist(payload.title, templateImagePath, payload.sections);
        setMessage("Checklist created.");
      }

      resetTemplateForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checklist could not be saved");
    }
  };

  const handleDuplicateTemplate = async (checklist: Checklist) => {
    setMessage("");
    setError("");

    const payload = {
      title: `${checklist.title} Copy`,
      imagePath: checklist.image_path || checklist.imagePath || "",
      sections: (checklist.sections || []).map((section) => ({
        title: section.title,
        items: (section.items || []).map((item) => ({
          question: item.question,
          answerType: item.answerType || item.answer_type || "FORMAT1",
          options: item.options || [],
        })),
      })),
    };

    try {
      await createChecklist(payload.title, payload.imagePath, payload.sections);
      setMessage("Template copied successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template could not be copied");
    }
  };

  const toggleTemplateShareForm = (checklistId: number) => {
    setShareForms((prev) => ({
      ...prev,
      [checklistId]: {
        open: !prev[checklistId]?.open,
        email: prev[checklistId]?.email || "",
        sending: false,
      },
    }));
    setExpandedRows((current) => ({
      ...current,
      [`template-${checklistId}`]: !shareForms[checklistId]?.open || current[`template-${checklistId}`],
    }));
  };

  const updateTemplateShareEmail = (checklistId: number, email: string) => {
    setShareForms((prev) => ({
      ...prev,
      [checklistId]: {
        open: true,
        email,
        sending: prev[checklistId]?.sending || false,
      },
    }));
  };

  const handleShareTemplate = async (checklist: Checklist) => {
    const cleanEmail = String(shareForms[checklist.id]?.email || "").trim();
    setMessage("");
    setError("");

    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    try {
      setShareForms((prev) => ({
        ...prev,
        [checklist.id]: {
          open: true,
          email: cleanEmail,
          sending: true,
        },
      }));
      const result = await shareChecklist(checklist.id, cleanEmail);
      setMessage(
        result.emailSent
          ? `${checklist.title} shared with ${cleanEmail}.`
          : `${checklist.title} shared in Messages for ${cleanEmail}. Email could not be sent.`
      );
      const inbox = await getMessages();
      setMessages(inbox.messages);
      setShareForms((prev) => ({
        ...prev,
        [checklist.id]: {
          open: false,
          email: "",
          sending: false,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template could not be shared");
      setShareForms((prev) => ({
        ...prev,
        [checklist.id]: {
          open: true,
          email: cleanEmail,
          sending: false,
        },
      }));
    }
  };

  const handleShareTemplateWithCommunity = async (checklist: Checklist) => {
    setMessage("");
    setError("");
    if (!window.confirm(`Share ${checklist.title} with the Inspectria community?`)) return;

    try {
      await shareChecklistWithCommunity(checklist.id);
      setMessage(`${checklist.title} shared with Community Templates.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template could not be shared with community");
    }
  };

  const openCommunityTemplate = async (checklist: Checklist) => {
    setMessage("");
    setError("");
    if (!checklist.communityTemplateId) return;

    try {
      setStartingTemplateId(checklist.id);
      const imported = await importCommunityTemplate(checklist.communityTemplateId);
      const result = await startTemplate(imported.checklistId);
      await load();
      await openAssignment({ ...result.assignment, isSelfStarted: true });
      setMessage(
        imported.reused
          ? `${imported.title} is already in your organization templates.`
          : `${imported.title} copied to your organization templates.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Community template could not be opened");
    } finally {
      setStartingTemplateId(null);
    }
  };

  const handleMarkMessageRead = async (messageId: number) => {
    setMessage("");
    setError("");

    try {
      await markMessageRead(messageId);
      const inbox = await getMessages();
      setMessages(inbox.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be updated");
    }
  };

  const handleToggleMessageExpanded = async (inboxMessage: AppMessage) => {
    setMessage("");
    setError("");

    const willExpand = !expandedMessageIds[inboxMessage.id];
    setExpandedMessageIds((prev) => ({
      ...prev,
      [inboxMessage.id]: willExpand,
    }));

    if (!willExpand || inboxMessage.readAt) return;

    try {
      await markMessageRead(inboxMessage.id);
      const inbox = await getMessages();
      setMessages(inbox.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be updated");
    }
  };

  const handleImportMessageTemplate = async (inboxMessage: AppMessage) => {
    setMessage("");
    setError("");

    try {
      const result = await importTemplateFromMessage(inboxMessage.id);
      setMessage(
        result.reused
          ? `${result.title} template already exists in Templates.`
          : `${result.title} template was imported into Templates.`
      );
      await load();
      setActiveAdminPage("templates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shared template could not be imported");
    }
  };

  const toggleMessageRecipient = (recipientId: number) => {
    setSelectedMessageRecipientIds((prev) =>
      prev.includes(recipientId)
        ? prev.filter((candidateId) => candidateId !== recipientId)
        : [...prev, recipientId]
    );
  };

  const toggleAllMessageRecipients = () => {
    setSelectedMessageRecipientIds(
      allMessageRecipientsSelected ? [] : messageRecipients.map((recipient) => recipient.id)
    );
  };

  const handleSendAppMessage = async () => {
    setMessage("");
    setError("");

    const titleValue = composeMessageTitle.trim();
    const bodyValue = composeMessageBody.trim();

    if (selectedMessageRecipientIds.length === 0) {
      setError("Please select at least one recipient.");
      return;
    }

    if (!titleValue || !bodyValue) {
      setError("Please enter a subject and message.");
      return;
    }

    try {
      setMessageSending(true);
      const result = await sendAppMessage({
        recipientUserIds: selectedMessageRecipientIds,
        title: titleValue,
        body: bodyValue,
      });
      const emailStatus =
        typeof result.emailSentCount === "number"
          ? ` Email sent to ${result.emailSentCount} recipient${
              result.emailSentCount === 1 ? "" : "s"
            }${result.emailFailedCount ? `; ${result.emailFailedCount} email failed.` : "."}`
          : "";
      setMessage(
        `Message sent to ${result.sentCount} recipient${
          result.sentCount === 1 ? "" : "s"
        }.${emailStatus}`
      );
      setComposeMessageTitle("");
      setComposeMessageBody("");
      setSelectedMessageRecipientIds([]);
      const inbox = await getMessages();
      setMessages(inbox.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent");
    } finally {
      setMessageSending(false);
    }
  };

  const assign = async () => {
    setMessage("");
    setError("");

    if (!selectedChecklistId || !selectedUserId) {
      setError("Checklist and user selection are required.");
      return;
    }

    try {
      await createAssignment(selectedChecklistId, selectedUserId);
      setMessage("Checklist assigned.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    }
  };

  const handleDownloadPdf = async (report: Report) => {
    const pdfPayload = mapReportToPdfPayload(report);
    await generateChecklistPdf(pdfPayload as any);
  };

  const handleEmailReport = (report: Report) => {
    setReportEmailTarget({ type: "checklist", report });
  };

  const sendChecklistReportEmail = async (report: Report, emails: string[]) => {
    setMessage("");
    setError("");

    try {
      setReportEmailSending(true);
      setMessage("Preparing report email...");
      const pdfPayload = mapReportToPdfPayload(report);
      const pdf = await generateChecklistPdf(pdfPayload as any, { output: "dataUri" });

      await emailReport({
        reportType: "checklist",
        reportId: report.id,
        to: emails,
        subject: `Inspectria Checklist Report: ${report.checklistTitle}`,
        message: "Please find the Inspectria checklist report attached.",
        attachmentBase64: pdf.dataUri,
        attachmentFileName: pdf.fileName,
      });

      setMessage("Report email sent.");
      setReportEmailTarget(null);
    } catch (err) {
      setMessage("");
      setError(err instanceof Error ? err.message : "Report email could not be sent.");
    } finally {
      setReportEmailSending(false);
    }
  };

  const handleEmailWalkthrough = (walkthrough: Walkthrough) => {
    setReportEmailTarget({ type: "walkthrough", walkthrough });
  };

  const sendWalkthroughReportEmail = async (walkthrough: Walkthrough, emails: string[]) => {
    setMessage("");
    setError("");

    try {
      setReportEmailSending(true);
      setMessage("Preparing walkthrough email...");
      const pdfPayload = mapWalkthroughToPdfPayload(walkthrough);
      const pdf = await generateChecklistPdf(pdfPayload as any, { output: "dataUri" });

      await emailReport({
        reportType: "walkthrough",
        reportId: walkthrough.id,
        to: emails,
        subject: `Inspectria Walkthrough Report: ${walkthrough.title}`,
        message: "Please find the Inspectria walkthrough report attached.",
        attachmentBase64: pdf.dataUri,
        attachmentFileName: pdf.fileName,
      });

      setMessage("Walkthrough email sent.");
      setReportEmailTarget(null);
    } catch (err) {
      setMessage("");
      setError(err instanceof Error ? err.message : "Walkthrough email could not be sent.");
    } finally {
      setReportEmailSending(false);
    }
  };

  const handleDownloadManagerSummary = async (report: Report) => {
    setMessage("");
    setError("");

    const failedItems = getReportFailedItems(report);

    if (failedItems.length === 0) {
      setError("This report has no negative YES/NO items to summarize.");
      return;
    }

    try {
      setManagerSummaryReportId(report.id);
      const result = await generateManagerSummary(report);
      setManagerSummaryPreview({ report, summary: result });
      setMessage(
        result.provider === "azure-openai" || result.provider === "openai"
          ? "Manager summary is ready. Use Print / Save as PDF to export it."
          : "Manager summary is ready with local fallback text. Use Print / Save as PDF to export it."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manager summary could not be generated");
    } finally {
      setManagerSummaryReportId(null);
    }
  };

  const handleCreateOrganization = async () => {
    setMessage("");
    setError("");

    if (!newOrgName.trim()) {
      setError("Organization name is required.");
      return;
    }

    const hasAdminInput =
      newOrgAdminEmail.trim() ||
      newOrgAdminUsername.trim() ||
      newOrgAdminPassword.trim() ||
      newOrgAdminName.trim();

    if (
      hasAdminInput &&
      (!newOrgAdminEmail.trim() ||
        !newOrgAdminUsername.trim() ||
        !newOrgAdminPassword.trim() ||
        !newOrgAdminName.trim())
    ) {
      setError("Admin email, username, password and full name are required together.");
      return;
    }

    if (hasAdminInput && !newOrgAdminEmail.includes("@")) {
      setError("A valid admin email address is required.");
      return;
    }

    try {
      await createOrganization({
        name: newOrgName.trim(),
        plan: isPlatformAdmin ? newOrgPlan.trim() || "standard" : "standard",
        parentOrganizationId: isPlatformAdmin
          ? newOrgParentOrganizationId || null
          : user.organizationId || null,
        ...(hasAdminInput
          ? {
              adminEmail: newOrgAdminEmail.trim(),
              adminUsername: newOrgAdminUsername.trim(),
              adminPassword: newOrgAdminPassword,
              adminName: newOrgAdminName.trim(),
            }
          : {}),
      });

      setNewOrgName("");
      setNewOrgPlan("standard");
      setNewOrgParentOrganizationId(0);
      setNewOrgAdminEmail("");
      setNewOrgAdminUsername("");
      setNewOrgAdminPassword("");
      setNewOrgAdminName("");
      setMessage("Organization created successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization could not be created");
    }
  };

  const handleToggleOrganization = async (organization: Organization) => {
    setMessage("");
    setError("");

    try {
      await updateOrganization(organization.id, { active: !organization.active });
      setMessage(
        organization.active
          ? `${organization.name} deactivated. Users from this organization were logged out.`
          : `${organization.name} activated.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization could not be updated");
    }
  };

  const handleDeleteOrganization = async (organization: Organization) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm(
      `Delete ${organization.name}? This will permanently delete its users and organization data.`
    );
    if (!confirmDelete) return;

    try {
      await deleteOrganization(organization.id);
      setMessage(`${organization.name} deleted successfully.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization could not be deleted");
    }
  };

  const handleActivateSubscription = async () => {
    setMessage("");
    setError("");

    if (!billingOrganizationId || !billingPlanId) {
      setError("Organization and billing plan are required.");
      return;
    }

    try {
      await createSubscription({
        organizationId: billingOrganizationId,
        planId: billingPlanId,
        billingCycle,
        status: "trialing",
        paymentMethod: billingPaymentMethod,
        externalCustomerId: billingExternalCustomerId,
        externalSubscriptionId: billingExternalSubscriptionId,
      });

      setBillingExternalCustomerId("");
      setBillingExternalSubscriptionId("");
      setMessage("Subscription activated successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription could not be activated");
    }
  };

  const handleCancelSubscription = async (subscriptionId: number) => {
    setMessage("");
    setError("");

    try {
      await cancelSubscription(subscriptionId);
      setMessage("Subscription canceled successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription could not be canceled");
    }
  };

  const handleRenewCurrentSubscription = async () => {
    setMessage("");
    setError("");
    setIyzicoCheckoutContent("");
    setIyzicoCheckoutToken("");

    if (!billingPlanId) {
      setError("Please select a subscription plan.");
      return;
    }

    try {
      const checkout = await initializeIyzicoCheckout({
        planId: billingPlanId,
        billingCycle,
      });
      setIyzicoCheckoutContent(checkout.checkoutFormContent);
      setIyzicoCheckoutToken(checkout.token);
      setMessage("iyzico checkout form is ready. Complete the payment form below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "iyzico checkout could not be started");
    }
  };

  const handleCancelCurrentSubscription = async () => {
    setMessage("");
    setError("");

    if (!window.confirm("Cancel this organization subscription?")) return;

    try {
      await cancelCurrentSubscription();
      setMessage("Subscription canceled successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription could not be canceled");
    }
  };

  const handleApproveOrganizationAdmin = async (targetUser: User) => {
    setMessage("");
    setError("");

    try {
      const result = await updateUser(targetUser.id, {
        approvalStatus: "approved",
        active: true,
        role: "admin",
      });
      setMessage(
        result.welcomeEmailSent
          ? `${targetUser.name} approved as organization admin. Welcome email sent.`
          : `${targetUser.name} approved as organization admin. Welcome email could not be sent: ${result.welcomeEmailError || "unknown error"}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization admin could not be approved");
    }
  };

  const handleCreateUser = async () => {
    setMessage("");
    setError("");

    if (!newEmail.trim() || !newUsername.trim() || !newPassword.trim() || !newName.trim()) {
      setError("Email, username, password and full name are required.");
      return;
    }

    if (!newEmail.includes("@")) {
      setError("A valid email address is required.");
      return;
    }

    if (organizations.length > 0 && !newUserOrganizationId) {
      setError("Organization selection is required.");
      return;
    }

    try {
      const result = await createUser({
        email: newEmail.trim(),
        username: newUsername.trim(),
        password: newPassword,
        name: newName.trim(),
        role: newRole,
        ...(newUserOrganizationId ? { organizationId: newUserOrganizationId } : {}),
      });

      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("user");
      setNewUserOrganizationId(0);
      setMessage(
        result.welcomeEmailSent
          ? "User created successfully. Welcome email sent."
          : `User created successfully, but the welcome email could not be sent: ${result.welcomeEmailError || "unknown error"}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be created");
    }
  };

  const startEditUser = (targetUser: User) => {
    setEditingUserId(targetUser.id);
    setEditUsername(targetUser.username);
    setEditEmail(targetUser.email || "");
    setEditPassword("");
    setEditName(targetUser.name);
    setEditRole(targetUser.role === "admin" ? "admin" : "user");
    setMessage("");
    setError("");
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUsername("");
    setEditEmail("");
    setEditPassword("");
    setEditName("");
    setEditRole("user");
  };

  const handleUpdateUser = async () => {
    if (!editingUserId) return;

    setMessage("");
    setError("");

    if (!editEmail.trim() || !editUsername.trim() || !editName.trim()) {
      setError("Email, username and full name are required.");
      return;
    }

    if (!editEmail.includes("@")) {
      setError("A valid email address is required.");
      return;
    }

    try {
      await updateUser(editingUserId, {
        email: editEmail.trim(),
        username: editUsername.trim(),
        name: editName.trim(),
        role: editRole,
        ...(editPassword.trim() ? { password: editPassword } : {}),
      });
      setMessage("User updated successfully.");
      cancelEditUser();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be updated");
    }
  };

  const handleChangeOwnPassword = async () => {
    setMessage("");
    setError("");

    if (!accountPassword.trim()) {
      setError("New password is required.");
      return;
    }

    if (accountPassword !== accountPasswordConfirm) {
      setError("Password confirmation does not match.");
      return;
    }

    try {
      await updateUser(user.id, { password: accountPassword });
      setAccountPassword("");
      setAccountPasswordConfirm("");
      setMessage("Password changed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be changed");
    }
  };

  const handleCreatePasswordResetLink = async (targetUser: User) => {
    setMessage("");
    setError("");
    setPasswordResetLinkLoadingId(targetUser.id);

    try {
      const result = await createPasswordResetLink(targetUser.id);
      setPasswordResetLinks((prev) => ({
        ...prev,
        [targetUser.id]: result.resetUrl,
      }));

      try {
        await navigator.clipboard.writeText(result.resetUrl);
        setMessage(`Password reset link copied for ${targetUser.username}. It expires in 1 hour.`);
      } catch {
        setMessage(`Password reset link generated for ${targetUser.username}. It expires in 1 hour.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset link could not be created");
    } finally {
      setPasswordResetLinkLoadingId(null);
    }
  };

  const handleCreateTemporaryPassword = async (targetUser: User) => {
    setMessage("");
    setError("");
    setTemporaryPasswordLoadingId(targetUser.id);

    try {
      const result = await createTemporaryPassword(targetUser.id);
      setTemporaryPasswords((prev) => ({
        ...prev,
        [targetUser.id]: result.temporaryPassword,
      }));
      setPasswordResetLinks((prev) => {
        const next = { ...prev };
        delete next[targetUser.id];
        return next;
      });

      try {
        await navigator.clipboard.writeText(result.temporaryPassword);
        setMessage(`Temporary password copied for ${targetUser.username}. Share it securely.`);
      } catch {
        setMessage(`Temporary password created for ${targetUser.username}. Share it securely.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Temporary password could not be created");
    } finally {
      setTemporaryPasswordLoadingId(null);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm("Are you sure you want to delete this user?");
    if (!confirmDelete) return;

    try {
      await deleteUser(userId);

      setMessage("User deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be deleted");
    }
  };

  const handleApproveUser = async (targetUser: User) => {
    setMessage("");
    setError("");

    const pendingForm = pendingUserForms[targetUser.id] || {
      username: targetUser.username,
      name: targetUser.name,
      email: targetUser.email || "",
    };

    if (!pendingForm.email.trim() || !pendingForm.username.trim() || !pendingForm.name.trim()) {
      setError("Email, username and full name are required before approval.");
      return;
    }

    if (!pendingForm.email.includes("@")) {
      setError("A valid email address is required before approval.");
      return;
    }

    try {
      const result = await updateUser(targetUser.id, {
        email: pendingForm.email.trim(),
        username: pendingForm.username.trim(),
        name: pendingForm.name.trim(),
        approvalStatus: "approved",
        active: true,
        role: targetUser.role === "admin" ? "admin" : "user",
      });
      setMessage(
        result.welcomeEmailSent
          ? `${targetUser.username} approved successfully. Welcome email sent.`
          : `${targetUser.username} approved successfully, but the welcome email could not be sent: ${result.welcomeEmailError || "unknown error"}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be approved");
    }
  };

  const handleDeleteTemplate = async (checklistId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm("Are you sure you want to delete this template?");
    if (!confirmDelete) return;

    try {
      await deleteChecklist(checklistId);
      if (editingId === checklistId) {
        resetTemplateForm();
      }
      setMessage("Template deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template could not be deleted");
    }
  };

  const handleForceDeleteTemplate = async (checklistId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm(
      "This will permanently delete the template and all linked assignments and reports. Do you want to continue?"
    );
    if (!confirmDelete) return;

    try {
      await forceDeleteChecklist(checklistId);
      if (editingId === checklistId) {
        resetTemplateForm();
      }
      setSelectedReport(null);
      setMessage("Template and linked records deleted successfully.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Template could not be force deleted"
      );
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm("Are you sure you want to delete this completed report?");
    if (!confirmDelete) return;

    try {
      await deleteReport(reportId);
      setSelectedReport(null);
      setMessage("Report deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report could not be deleted");
    }
  };

  const handleDeleteWalkthrough = async (walkthroughId: number) => {
    setMessage("");
    setError("");

    const confirmDelete = window.confirm("Are you sure you want to delete this walkthrough report?");
    if (!confirmDelete) return;

    try {
      await deleteWalkthrough(walkthroughId);
      setSelectedWalkthrough(null);
      setMessage("Walkthrough report deleted successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Walkthrough report could not be deleted");
    }
  };

  const resetWalkthroughForm = () => {
    setEditingWalkthroughId(null);
    setWalkthroughTitle("");
    setWalkthroughLocation("");
    setWalkthroughSections([
      { title: "General", items: [{ comment: "", severity: "", photos: [] }] },
    ]);
  };

  const normalizeWalkthroughPayload = (status: "draft" | "completed") => ({
    title: walkthroughTitle.trim(),
    location: walkthroughLocation.trim(),
    status,
    sections: walkthroughSections
      .map((section) => ({
        title: section.title.trim(),
        items: section.items
          .map((item) => ({
            comment: item.comment.trim(),
            severity: (item.severity || "").trim(),
            photos: item.photos || [],
          }))
          .filter((item) => item.comment || item.photos.length > 0),
      }))
      .filter((section) => section.title && section.items.length > 0),
  });

  const addWalkthroughSection = () => {
    setWalkthroughSections((prev) => [
      ...prev,
      { title: `Section ${prev.length + 1}`, items: [{ comment: "", severity: "", photos: [] }] },
    ]);
  };

  const updateWalkthroughSectionTitle = (sectionIndex: number, title: string) => {
    setWalkthroughSections((prev) =>
      prev.map((section, index) => (index === sectionIndex ? { ...section, title } : section))
    );
  };

  const addWalkthroughItem = (sectionIndex: number) => {
    setWalkthroughSections((prev) =>
      prev.map((section, index) =>
        index === sectionIndex
          ? { ...section, items: [...section.items, { comment: "", severity: "", photos: [] }] }
          : section
      )
    );
  };

  const updateWalkthroughItem = (
    sectionIndex: number,
    itemIndex: number,
    patch: Partial<{ comment: string; severity: string; photos: string[] }>
  ) => {
    setWalkthroughSections((prev) =>
      prev.map((section, index) =>
        index === sectionIndex
          ? {
              ...section,
              items: section.items.map((item, currentItemIndex) =>
                currentItemIndex === itemIndex ? { ...item, ...patch } : item
              ),
            }
          : section
      )
    );
  };

  const removeWalkthroughItem = (sectionIndex: number, itemIndex: number) => {
    setWalkthroughSections((prev) =>
      prev.map((section, index) => {
        if (index !== sectionIndex) return section;
        const nextItems = section.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex);
        return {
          ...section,
          items: nextItems.length ? nextItems : [{ comment: "", severity: "", photos: [] }],
        };
      })
    );
  };

  const handleWalkthroughPhotos = async (
    sectionIndex: number,
    itemIndex: number,
    files: FileList | null
  ) => {
    if (!files || files.length === 0) return;

    const key = `${sectionIndex}-${itemIndex}`;
    try {
      setWalkthroughUploadingKey(key);
      const uploaded = await uploadPhotos(files);
      const currentPhotos = walkthroughSections[sectionIndex]?.items[itemIndex]?.photos || [];
      updateWalkthroughItem(sectionIndex, itemIndex, {
        photos: [...currentPhotos, ...uploaded],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setWalkthroughUploadingKey(null);
    }
  };

  const removeWalkthroughPhoto = (sectionIndex: number, itemIndex: number, photoIndex: number) => {
    const currentPhotos = walkthroughSections[sectionIndex]?.items[itemIndex]?.photos || [];
    updateWalkthroughItem(sectionIndex, itemIndex, {
      photos: currentPhotos.filter((_, index) => index !== photoIndex),
    });
  };

  const saveWalkthrough = async (status: "draft" | "completed") => {
    setMessage("");
    setError("");
    const payload = normalizeWalkthroughPayload(status);

    if (!payload.title) {
      setError("Walkthrough title is required.");
      return;
    }

    if (payload.sections.length === 0) {
      setError("Add at least one section with a comment or photo.");
      return;
    }

    try {
      if (editingWalkthroughId) {
        await updateWalkthrough(editingWalkthroughId, payload);
        setMessage(status === "completed" ? "Walkthrough completed." : "Walkthrough draft updated.");
      } else {
        await createWalkthrough(payload);
        setMessage(status === "completed" ? "Walkthrough completed." : "Walkthrough draft saved.");
      }

      resetWalkthroughForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Walkthrough could not be saved");
    }
  };

  const editWalkthrough = (walkthrough: Walkthrough) => {
    setEditingWalkthroughId(walkthrough.id);
    setWalkthroughTitle(walkthrough.title);
    setWalkthroughLocation(walkthrough.location || "");
    setWalkthroughSections(
      walkthrough.sections.length
        ? walkthrough.sections.map((section) => ({
            title: section.title,
            items: section.items.length
              ? section.items.map((item) => ({
                  comment: item.comment || "",
                  severity: item.severity || "",
                  photos: item.photos || [],
                }))
              : [{ comment: "", severity: "", photos: [] }],
          }))
        : [{ title: "General", items: [{ comment: "", severity: "", photos: [] }] }]
    );
    setActiveAdminPage("walkthroughs");
    setMessage("Walkthrough draft loaded.");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const currentSubscription = billing.currentSubscription;
  const selectedBillingPlan =
    billing.plans.find((plan) => plan.id === billingPlanId) || billing.plans[0] || null;
  const billingUsage = billing.usage;
  const activeUsers = users.filter(
    (candidate) => candidate.active !== false && candidate.approvalStatus !== "pending"
  );
  const organizationAdmins = activeUsers.filter((candidate) => candidate.role === "admin");
  const organizationInspectors = activeUsers.filter((candidate) => candidate.role === "user");
  const openAssignments = assignments.filter((assignment) => assignment.status !== "completed");
  const completedAssignments = assignments.filter((assignment) => assignment.status === "completed");
  const completedWalkthroughs = walkthroughs.filter(
    (walkthrough) => walkthrough.status === "completed"
  );
  const siteNames = Array.from(
    new Set(
      walkthroughs
        .map((walkthrough) => (walkthrough.location || "").trim())
        .filter(Boolean)
    )
  ).sort((first, second) => first.localeCompare(second));
  const siteCount = siteNames.length || (user.organizationName ? 1 : 0);
  const subscriptionDaysTotal = getDaysBetween(
    currentSubscription?.startedAt,
    currentSubscription?.renewsAt
  );
  const subscriptionDaysLeft = currentSubscription
    ? getDaysBetween(new Date().toISOString(), currentSubscription.renewsAt)
    : null;
  const subscriptionProgress =
    subscriptionDaysTotal && subscriptionDaysLeft !== null
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(((subscriptionDaysTotal - subscriptionDaysLeft) / subscriptionDaysTotal) * 100)
          )
        )
      : 0;
  const templateSuccessRows = useMemo(
    () =>
      checklists
        .map((checklist) => {
          const templateReports = reports.filter(
            (report) => report.checklistTitle === checklist.title
          );
          let successfulAnswers = 0;
          let failedAnswers = 0;
          let notApplicableAnswers = 0;
          let scoredAnswers = 0;

          templateReports.forEach((report) => {
            (report.items || []).forEach((item) => {
              const answer = normalizeAnswer(item.answer);
              if (answer === "YES") {
                successfulAnswers += 1;
                scoredAnswers += 1;
              } else if (answer === "NO") {
                failedAnswers += 1;
                scoredAnswers += 1;
              } else if (answer === "N/A" || answer === "NA") {
                notApplicableAnswers += 1;
              }
            });
          });

          const successRate = scoredAnswers
            ? Math.round((successfulAnswers / scoredAnswers) * 100)
            : 0;
          const latestReportAt = templateReports
            .map((report) => report.completed_at)
            .filter(Boolean)
            .sort((first, second) => new Date(second).getTime() - new Date(first).getTime())[0];

          return {
            id: checklist.id,
            title: checklist.title,
            reportCount: templateReports.length,
            successfulAnswers,
            failedAnswers,
            notApplicableAnswers,
            scoredAnswers,
            successRate,
            latestReportAt,
          };
        })
        .sort((first, second) => {
          if (second.reportCount !== first.reportCount) {
            return second.reportCount - first.reportCount;
          }
          return first.title.localeCompare(second.title);
        }),
    [checklists, reports]
  );
  const overallScoredAnswers = templateSuccessRows.reduce(
    (total, row) => total + row.scoredAnswers,
    0
  );
  const overallSuccessfulAnswers = templateSuccessRows.reduce(
    (total, row) => total + row.successfulAnswers,
    0
  );
  const overallSuccessRate = overallScoredAnswers
    ? Math.round((overallSuccessfulAnswers / overallScoredAnswers) * 100)
    : 0;
  const recentReports = [...reports]
    .sort((first, second) => new Date(second.completed_at).getTime() - new Date(first.completed_at).getTime());
  const dashboardSiteRows = siteNames.length ? siteNames : [user.organizationName || "Main location"];
  const organizationUserRows = users
    .filter((candidate) => candidate.role !== "platform_admin")
    .map((candidate) => {
      const organization = organizations.find(
        (item) => item.id === candidate.organizationId
      );

      return {
        id: candidate.id,
        organizationName:
          candidate.organizationName ||
          organization?.name ||
          getOrganizationLabel(organization, candidate.organizationId),
        userName: candidate.name || candidate.username,
        email: candidate.email || "No email provided",
        role: candidate.role,
      };
    })
    .sort((first, second) => {
      const organizationSort = first.organizationName.localeCompare(second.organizationName);
      if (organizationSort !== 0) return organizationSort;
      return first.userName.localeCompare(second.userName);
    });
  const toggleExpandedRow = (rowKey: string) => {
    setExpandedRows((current) => ({ ...current, [rowKey]: !current[rowKey] }));
  };

  const isExpandedRow = (rowKey: string) => Boolean(expandedRows[rowKey]);
  const getVisibleListCount = (listKey: string) =>
    visibleListCounts[listKey] ?? LIST_PAGE_SIZE;
  const getVisibleListStart = (listKey: string) =>
    Math.max(0, getVisibleListCount(listKey) - LIST_PAGE_SIZE);
  const showMoreListItems = (listKey: string) => {
    setVisibleListCounts((current) => ({
      ...current,
      [listKey]: (current[listKey] ?? LIST_PAGE_SIZE) + LIST_PAGE_SIZE,
    }));
  };
  const goBackListItems = (listKey: string) => {
    setVisibleListCounts((current) => ({
      ...current,
      [listKey]: Math.max(
        LIST_PAGE_SIZE,
        (current[listKey] ?? LIST_PAGE_SIZE) - LIST_PAGE_SIZE
      ),
    }));
  };

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      {reportEmailTarget ? (
        <ReportEmailDialog
          title={
            reportEmailTarget.type === "checklist"
              ? reportEmailTarget.report.checklistTitle
              : reportEmailTarget.walkthrough.title
          }
          recipients={availableReportEmailRecipients}
          isSending={reportEmailSending}
          onCancel={() => {
            if (!reportEmailSending) setReportEmailTarget(null);
          }}
          onSend={(emails) =>
            reportEmailTarget.type === "checklist"
              ? sendChecklistReportEmail(reportEmailTarget.report, emails)
              : sendWalkthroughReportEmail(reportEmailTarget.walkthrough, emails)
          }
        />
      ) : null}

      {pendingImportFile ? (
        <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
          <div className="app-modal">
            <div className="app-modal-heading">
              <div>
                <span>Excel Import</span>
                <h3 id="excel-import-title">Check your file format before importing</h3>
              </div>
            </div>
            <div className="app-modal-body">
              <p>
                The simplest import format is one Question column. Section and Answer Type are optional.
                If you include all columns, use this order:
              </p>
              <div className="excel-import-column-grid">
                <strong>Section</strong>
                <strong>Question</strong>
                <strong>Answer Type</strong>
              </div>
              <p>
                If Section is blank or missing, all questions will be imported into one section named
                Imported Questions. If Answer Type is blank or missing, questions will use FORMAT1
                with YES / NO / N/A answer buttons.
              </p>
              <p>
                When you do provide Answer Type, use one of these formats:
              </p>
              <ul>
                <li><strong>FORMAT1</strong> - standard YES / NO / N/A answer buttons.</li>
                <li><strong>DATE</strong> - date picker answer.</li>
                <li><strong>TEXT</strong> - free-text answer field.</li>
                <li><strong>MULTIPLE_CHOICE</strong> - single selected option.</li>
                <li><strong>RADIO_BUTTON</strong> - selectable option list.</li>
              </ul>
              <p>
                Selected file: <strong>{pendingImportFile.name}</strong>. If the file needs
                formatting, cancel now, update the spreadsheet, and choose the file again.
              </p>
            </div>
            <div className="app-modal-actions">
              <button type="button" style={styles.secondaryButton} onClick={cancelExcelImport}>
                Cancel
              </button>
              <button type="button" style={styles.button} onClick={continueExcelImport}>
                Continue Import
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedWalkthrough ? (
        <WalkthroughDetail
          walkthrough={selectedWalkthrough}
          onBack={() => setSelectedWalkthrough(null)}
          onEmailReport={handleEmailWalkthrough}
          onDeleteReport={(walkthrough) => handleDeleteWalkthrough(walkthrough.id)}
        />
      ) : selectedReport ? (
        <div>
          {message ? (
            <div style={{ ...styles.section, background: "#e6f7f5", color: "#06323f", marginTop: 0 }}>
              <div>{message}</div>
              {generatedDownload ? (
                <a
                  href={generatedDownload.url}
                  download={generatedDownload.preview ? undefined : generatedDownload.fileName}
                  target={generatedDownload.preview ? "_blank" : undefined}
                  rel={generatedDownload.preview ? "noopener" : undefined}
                  style={{
                    ...styles.button,
                    display: "inline-block",
                    marginTop: 10,
                    textDecoration: "none",
                  }}
                >
                  {generatedDownload.label}
                </a>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div style={{ ...styles.section, background: "#fef2f2", color: "#991b1b", marginTop: 0 }}>
              {error}
            </div>
          ) : null}

          {managerSummaryPreview ? (
            <ManagerSummaryPanel
              report={managerSummaryPreview.report}
              summary={managerSummaryPreview.summary}
              onClose={() => setManagerSummaryPreview(null)}
            />
          ) : null}

          <div
            className="responsive-report-top"
            style={{ ...styles.row, justifyContent: "space-between", marginBottom: 14 }}
          >
            <button
              style={styles.secondaryButton}
                      onClick={() => setSelectedReport(null)}
            >
              Back
            </button>

            <div className="responsive-report-actions" style={styles.row}>
              <button
                style={styles.button}
                      onClick={() => handleDownloadPdf(selectedReport)}
              >
                Download PDF
              </button>
              <button
                style={styles.secondaryButton}
                      onClick={() => handleEmailReport(selectedReport)}
              >
                Email Report
              </button>
              <a
                style={{ ...styles.button, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                href={getActionPlanExcelDownloadUrl(selectedReport.id)}
              >
                AI Action Plan Excel
              </a>
              <button
                style={styles.button}
                      onClick={() => handleDownloadManagerSummary(selectedReport)}
                disabled={managerSummaryReportId === selectedReport.id}
              >
                {managerSummaryReportId === selectedReport.id
                  ? "Preparing Summary..."
                  : "Manager Summary"}
              </button>
              <button
                style={styles.button}
                      onClick={() => handleDeleteReport(selectedReport.id)}
              >
                Delete Report
              </button>
            </div>
          </div>

          <ReportDetail
            report={selectedReport}
            onBack={() => setSelectedReport(null)}
            onDownloadPdf={handleDownloadPdf}
            onEmailReport={handleEmailReport}
            onDeleteReport={(report) => handleDeleteReport(Number(report.id))}
            onDownloadActionPlan={(report) => {
              window.location.href = getActionPlanExcelDownloadUrl(report.id);
            }}
            onDownloadManagerSummary={handleDownloadManagerSummary}
            managerSummaryLoading={managerSummaryReportId === selectedReport.id}
          />
        </div>
      ) : (
        <>
          <div className="admin-workspace">
            <div
              className={`admin-module-nav${isMobileNavigationOpen ? " admin-module-nav-open" : ""}`}
            >
              <button
                type="button"
                className="admin-module-nav-toggle"
                      onClick={() => setIsMobileNavigationOpen((isOpen) => !isOpen)}
                aria-expanded={isMobileNavigationOpen}
                aria-controls="admin-module-nav-grid"
              >
                {isMobileNavigationOpen ? "Close menu" : "Menu"}
                <span aria-hidden="true">{isMobileNavigationOpen ? "−" : "+"}</span>
              </button>
              <div
                id="admin-module-nav-grid"
                className="admin-module-nav-grid"
              >
                {visibleAdminSections.map((section) => {
                  const isActive = activeAdminPage === section.key;
                  const sectionLabel =
                    !isPlatformAdmin && section.key === "organizations"
                      ? "Sub Organizations"
                      : section.label;
                  const unreadMessageBadge =
                    section.key === "messages" && unreadMessageCount > 0
                      ? unreadMessageCount
                      : 0;
                  const unreadReportBadge =
                    section.key === "reports" && unreadReportCount > 0
                      ? unreadReportCount
                      : 0;
                  const navBadge = unreadMessageBadge || unreadReportBadge;
                  const sectionDescription =
                    !isPlatformAdmin && section.key === "organizations"
                      ? "Create sub-organizations and assign admins"
                      : !isPlatformAdmin && section.key === "billing"
                        ? "View tenant status"
                        : section.description;

                  return (
                    <button
                      key={section.key}
                      type="button"
                      className={`admin-module-nav-item${isActive ? " admin-module-nav-item-active" : ""}`}
                      onClick={() => {
                        if (section.key === "support") {
                          window.location.hash = "support";
                          return;
                        }
                        setActiveAdminPage(section.key);
                        setIsMobileNavigationOpen(false);
                        setSelectedReport(null);
                        setMessage("");
                        setError("");
                      }}
                    >
                      <div className="admin-module-nav-label">
                        <span>{sectionLabel}</span>
                        {navBadge > 0 ? (
                          <span
                            className="admin-module-nav-badge"
                            aria-label={
                              unreadReportBadge > 0
                                ? `${unreadReportBadge} new completed reports`
                                : `${unreadMessageBadge} unread messages`
                            }
                          >
                            {navBadge}
                          </span>
                        ) : null}
                      </div>
                      <div className="admin-module-nav-description">
                        {sectionDescription}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="admin-workspace-main">
          {message ? (
            <div style={{ ...styles.section, background: "#e6f7f5", color: "#06323f" }}>
              <div>{message}</div>
              {generatedDownload ? (
                <a
                  href={generatedDownload.url}
                  download={generatedDownload.preview ? undefined : generatedDownload.fileName}
                  target={generatedDownload.preview ? "_blank" : undefined}
                  rel={generatedDownload.preview ? "noopener" : undefined}
                  style={{
                    ...styles.button,
                    display: "inline-block",
                    marginTop: 10,
                    textDecoration: "none",
                  }}
                >
                  {generatedDownload.label}
                </a>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div style={{ ...styles.section, background: "#fef2f2", color: "#991b1b" }}>
              {error}
            </div>
          ) : null}

          {managerSummaryPreview ? (
            <ManagerSummaryPanel
              report={managerSummaryPreview.report}
              summary={managerSummaryPreview.summary}
              onClose={() => setManagerSummaryPreview(null)}
            />
          ) : null}

          {activeAdminPage === "dashboard" && !isPlatformAdmin && isDesktop ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Organization Dashboard</h3>
                  <p>
                    Sites, team access, billing preview, templates, assignment volume, and completed
                    checklist success rates in one operational view.
                  </p>
                </div>
              </div>

              <div className="org-dashboard-grid">
                <div className="org-dashboard-hero">
                  <div>
                    <div className="org-dashboard-eyebrow">Organization</div>
                    <h4>{user.organizationName || "Current Organization"}</h4>
                    <p>
                      {currentSubscription
                        ? `${currentSubscription.planName} plan is ${currentSubscription.status}.`
                        : "No active subscription is attached yet."}
                    </p>
                  </div>
                  <div className="org-dashboard-score">
                    <strong>{overallSuccessRate}%</strong>
                    <span>Overall Success</span>
                  </div>
                </div>

                <div className="org-dashboard-metrics">
                  <div>
                    <span>Sites</span>
                    <strong>{siteCount}</strong>
                    <small>
                      {siteNames.length
                        ? siteNames.slice(0, 3).join(", ")
                        : user.organizationName || "Main location"}
                    </small>
                  </div>
                  <div>
                    <span>Sub Organizations</span>
                    <strong>{subOrganizations.length}</strong>
                    <small>
                      {subOrganizations.length
                        ? subOrganizations.slice(0, 3).map((organization) => organization.name).join(", ")
                        : "No sub-organizations"}
                    </small>
                  </div>
                  <div>
                    <span>Total Users</span>
                    <strong>{activeUsers.length}</strong>
                    <small>{organizationInspectors.length} users, {organizationAdmins.length} admins</small>
                  </div>
                  <div>
                    <span>Templates</span>
                    <strong>{checklists.length}</strong>
                    <small>{overallScoredAnswers} scored answers completed</small>
                  </div>
                  <div>
                    <span>Reports</span>
                    <strong>{reports.length}</strong>
                    <small>{completedWalkthroughs.length} walkthroughs completed</small>
                  </div>
                  <div>
                    <span>Open Assignments</span>
                    <strong>{openAssignments.length}</strong>
                    <small>{completedAssignments.length} completed assignments</small>
                  </div>
                  <div>
                    <span>Plan Usage</span>
                    <strong>{billingUsage?.userCount ?? activeUsers.length}</strong>
                    <small>
                      {currentSubscription
                        ? `${formatLimit(currentSubscription.userLimit, "users")} allowed`
                        : "No plan limit"}
                    </small>
                  </div>
                </div>
              </div>

              <div className="org-dashboard-split">
                <div className="org-dashboard-panel">
                  <div className="org-dashboard-panel-title">
                    <h4>Billing Preview</h4>
                    <span>{currentSubscription?.billingCycle || "no cycle"}</span>
                  </div>
                  <div className="billing-preview-line">
                    <span>Plan</span>
                    <strong>{currentSubscription?.planName || "-"}</strong>
                  </div>
                  <div className="billing-preview-line">
                    <span>Amount</span>
                    <strong>
                      {currentSubscription
                        ? `${formatMoney(
                            currentSubscription.amountCents,
                            currentSubscription.currency
                          )} / ${currentSubscription.billingCycle}`
                        : "-"}
                    </strong>
                  </div>
                  <div className="billing-preview-line">
                    <span>Start</span>
                    <strong>{formatDate(currentSubscription?.startedAt)}</strong>
                  </div>
                  <div className="billing-preview-line">
                    <span>Renewal / End</span>
                    <strong>{formatDate(currentSubscription?.renewsAt)}</strong>
                  </div>
                  <div className="billing-preview-line">
                    <span>Remaining</span>
                    <strong>
                      {subscriptionDaysLeft === null
                        ? "-"
                        : `${Math.max(0, subscriptionDaysLeft)} days`}
                    </strong>
                  </div>
                  <div className="subscription-progress" aria-label="Subscription period progress">
                    <span style={{ width: `${subscriptionProgress}%` }} />
                  </div>
                  <div className="org-dashboard-footnote">
                    Retention: {currentSubscription?.reportRetentionDays || "-"} days | Template limit:{" "}
                    {currentSubscription
                      ? formatLimit(currentSubscription.checklistLimit, "templates")
                      : "-"}
                  </div>
                </div>

                <div className="org-dashboard-panel">
                  <div className="org-dashboard-panel-title">
                    <h4>Team & Workload</h4>
                    <span>{activeUsers.length} active</span>
                  </div>
                  <div className="team-breakdown">
                    <div>
                      <strong>{organizationAdmins.length}</strong>
                      <span>Admins</span>
                    </div>
                    <div>
                      <strong>{organizationInspectors.length}</strong>
                      <span>Users</span>
                    </div>
                    <div>
                      <strong>{pendingUsers.length}</strong>
                      <span>Pending</span>
                    </div>
                    <div>
                      <strong>{assignments.length}</strong>
                      <span>Assignments</span>
                    </div>
                  </div>
                  <div className="mini-list">
                    {activeUsers
                      .slice(
                        getVisibleListStart("dashboard-users"),
                        getVisibleListCount("dashboard-users")
                      )
                      .map((member) => (
                      <div key={member.id}>
                        <span>{member.name || member.username}</span>
                        <strong>{member.role}</strong>
                      </div>
                    ))}
                    {activeUsers.length === 0 ? (
                      <div>
                        <span>No active users</span>
                        <strong>-</strong>
                      </div>
                    ) : null}
                    <ShowMoreButton
                      visibleCount={getVisibleListCount("dashboard-users")}
                      totalCount={activeUsers.length}
                      onBack={() => goBackListItems("dashboard-users")}
                      onClick={() => showMoreListItems("dashboard-users")}
                    />
                  </div>
                </div>
              </div>

              <div className="org-dashboard-performance-layout">
                <div className="org-dashboard-panel template-performance-panel">
                  <div className="org-dashboard-panel-title">
                    <h4>Template Success Totals</h4>
                    <span>{templateSuccessRows.length} templates</span>
                  </div>
                  <div className="template-gauge-grid">
                    {templateSuccessRows
                      .slice(
                        getVisibleListStart("dashboard-template-success"),
                        getVisibleListCount("dashboard-template-success")
                      )
                      .map((row) => (
                      <div key={row.id} className="template-gauge-card">
                        <div
                          className="template-gauge"
                          style={{
                            background: `conic-gradient(#0f766e ${row.successRate}%, #e6f3f1 0)`,
                          }}
                        >
                          <div>
                            <strong>{row.successRate}%</strong>
                            <span>success</span>
                          </div>
                        </div>
                        <div className="template-gauge-details">
                          <strong>{row.title}</strong>
                          <span>
                            {row.reportCount} reports | {row.successfulAnswers} yes /{" "}
                            {row.failedAnswers} no
                          </span>
                          <small>
                            {row.scoredAnswers} scored | {row.notApplicableAnswers} N/A | Latest{" "}
                            {formatDate(row.latestReportAt)}
                          </small>
                        </div>
                      </div>
                    ))}
                    <ShowMoreButton
                      visibleCount={getVisibleListCount("dashboard-template-success")}
                      totalCount={templateSuccessRows.length}
                      onBack={() => goBackListItems("dashboard-template-success")}
                      onClick={() => showMoreListItems("dashboard-template-success")}
                    />
                    {templateSuccessRows.length === 0 ? (
                      <div style={styles.small}>No templates found.</div>
                    ) : null}
                  </div>
                </div>

                <div className="org-dashboard-stack">
                  <div className="org-dashboard-panel">
                    <div className="org-dashboard-panel-title">
                      <h4>Recent Completed Reports</h4>
                      <span>{reports.length} total</span>
                    </div>
                    <div className="mini-list">
                      {recentReports
                        .slice(
                          getVisibleListStart("dashboard-recent-reports"),
                          getVisibleListCount("dashboard-recent-reports")
                        )
                        .map((report) => (
                        <button
                          key={report.id}
                          type="button"
                          className="mini-list-button"
                      onClick={() => setSelectedReport(report)}
                        >
                          <span>{report.checklistTitle}</span>
                          <strong>{formatDate(report.completed_at)}</strong>
                        </button>
                      ))}
                      <ShowMoreButton
                        visibleCount={getVisibleListCount("dashboard-recent-reports")}
                        totalCount={recentReports.length}
                        onBack={() => goBackListItems("dashboard-recent-reports")}
                      onClick={() => showMoreListItems("dashboard-recent-reports")}
                      />
                      {recentReports.length === 0 ? (
                        <div>
                          <span>No completed reports yet</span>
                          <strong>-</strong>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="org-dashboard-panel">
                    <div className="org-dashboard-panel-title">
                      <h4>Site Signals</h4>
                      <span>{siteCount} tracked</span>
                    </div>
                    <div className="mini-list">
                      {dashboardSiteRows
                        .slice(
                          getVisibleListStart("dashboard-sites"),
                          getVisibleListCount("dashboard-sites")
                        )
                        .map((siteName) => (
                          <div key={siteName}>
                            <span>{siteName}</span>
                            <strong>
                              {
                                walkthroughs.filter(
                                  (walkthrough) => (walkthrough.location || "").trim() === siteName
                                ).length || "-"
                              }
                            </strong>
                          </div>
                        ))}
                      <ShowMoreButton
                        visibleCount={getVisibleListCount("dashboard-sites")}
                        totalCount={dashboardSiteRows.length}
                        onBack={() => goBackListItems("dashboard-sites")}
                      onClick={() => showMoreListItems("dashboard-sites")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeAdminPage === "messages" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Messages</h3>
                  <p>Send in-app messages and review template shares sent to your account.</p>
                </div>
              </div>

              <div className="message-composer">
                <div>
                  <h4>New Message</h4>
                  <p>
                    {isPlatformAdmin
                      ? "Choose active users and admins across managed organizations."
                      : "Choose active users and admins in your organization."}
                  </p>
                </div>
                <input
                  style={styles.input}
                  value={composeMessageTitle}
                  onChange={(event) => setComposeMessageTitle(event.target.value)}
                  placeholder="Subject"
                  maxLength={160}
                />
                <textarea
                  style={{ ...styles.input, minHeight: 96, resize: "vertical" }}
                  value={composeMessageBody}
                  onChange={(event) => setComposeMessageBody(event.target.value)}
                  placeholder="Message"
                  maxLength={4000}
                />
                <div className="message-recipient-toolbar">
                  <label className="message-recipient-check">
                    <input
                      type="checkbox"
                      checked={allMessageRecipientsSelected}
                      disabled={messageRecipients.length === 0}
                      onChange={toggleAllMessageRecipients}
                    />
                    <span>Select all</span>
                  </label>
                  <span>
                    {selectedMessageRecipientIds.length} of {messageRecipients.length} selected
                  </span>
                </div>
                {messageRecipients.length === 0 ? (
                  <div style={styles.small}>No active recipients found.</div>
                ) : (
                  <div className="message-recipient-list" aria-label="Message recipients">
                    {messageRecipients.map((recipient) => (
                      <label key={recipient.id} className="message-recipient-row">
                        <input
                          type="checkbox"
                          checked={selectedMessageRecipientSet.has(recipient.id)}
                          onChange={() => toggleMessageRecipient(recipient.id)}
                        />
                        <span>
                          <strong>{recipient.name || recipient.username}</strong>
                          <small>
                            {recipient.email || recipient.username} | {recipient.role}
                            {recipient.organizationName ? ` | ${recipient.organizationName}` : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <div>
                  <button
                    type="button"
                    style={styles.button}
                      onClick={handleSendAppMessage}
                    disabled={
                      messageSending ||
                      selectedMessageRecipientIds.length === 0 ||
                      !composeMessageTitle.trim() ||
                      !composeMessageBody.trim()
                    }
                  >
                    {messageSending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>

              {messages.length === 0 ? (
                <div style={styles.small}>No messages found.</div>
              ) : (
                <div className="compact-list">
                  {messages.map((inboxMessage) => {
                    const isTemplateShare = inboxMessage.type === "template_share";
                    const isImported = Boolean(inboxMessage.importedAt);
                    const isOpen = Boolean(expandedMessageIds[inboxMessage.id]);
                    const isExpired =
                      inboxMessage.expiresAt &&
                      new Date(inboxMessage.expiresAt).getTime() < Date.now();

                    return (
                      <div
                        key={inboxMessage.id}
                        className={`compact-row message-row ${
                          isOpen ? "compact-row-open" : ""
                        } ${!inboxMessage.readAt ? "message-row-unread" : ""}`}
                      >
                        <div className="compact-row-main">
                          <button
                            type="button"
                            className="compact-row-toggle"
                      onClick={() => handleToggleMessageExpanded(inboxMessage)}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "Collapse message" : "Expand message"}
                          >
                            {isOpen ? "-" : "+"}
                          </button>
                          <div className="compact-row-title message-row-title">
                            <span className="message-title-line">
                              <span
                                className="message-status-dot"
                                title={inboxMessage.readAt ? "Read" : "Unread"}
                              />
                              <strong>{inboxMessage.title}</strong>
                            </span>
                            <span className="message-preview">{inboxMessage.body}</span>
                            <span>{formatDateTime(inboxMessage.createdAt)}</span>
                          </div>
                        </div>
                        <div className="compact-row-meta">
                          <span>
                            {isImported
                              ? "Imported"
                              : isExpired
                                ? "Expired"
                                : inboxMessage.readAt
                                  ? "Read"
                                  : "Unread"}
                          </span>
                        </div>
                        {isOpen ? (
                          <div className="message-row-body">
                            <p>{inboxMessage.body}</p>
                          </div>
                        ) : null}
                        <div className="compact-row-actions">
                          {isTemplateShare && !isImported && !isExpired ? (
                            <button
                              type="button"
                              style={styles.button}
                      onClick={() => handleImportMessageTemplate(inboxMessage)}
                            >
                              Import Template
                            </button>
                          ) : null}
                          {!inboxMessage.readAt ? (
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => handleMarkMessageRead(inboxMessage.id)}
                            >
                              Mark Read
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {activeAdminPage === "account" ? (
            <div style={styles.section}>
              <h3 style={styles.title}>My Account</h3>
              <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                <div style={{ marginBottom: 12 }}>
                  <strong>{user.name}</strong> ({user.username})
                  <div style={styles.small}>{user.role}</div>
                </div>
                <div style={{ ...styles.row, marginBottom: 12 }}>
                  <PasswordInput
                    placeholder="New Password"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.target.value)}
                  />
                  <PasswordInput
                    placeholder="Confirm New Password"
                    value={accountPasswordConfirm}
                    onChange={(e) => setAccountPasswordConfirm(e.target.value)}
                  />
                </div>
                <button type="button" style={styles.button} onClick={handleChangeOwnPassword}>
                  Change Password
                </button>
              </div>
            </div>
          ) : null}

          {activeAdminPage === "organizations" && canViewSubOrganizations ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Organizations</h3>
                  <p>Manage tenant accounts, sub-organizations, administrator access, and status.</p>
                </div>
              </div>

              <div className="admin-two-column organization-layout">
              <div className="admin-side-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                {canCreateSubOrganizations ? (
                <>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>
                  {isPlatformAdmin ? "Create Organization" : "Create Sub-Organization"}
                </h4>
                <div className="admin-form-grid admin-form-grid-2" style={{ ...styles.row, marginBottom: 12 }}>
                  <input
                    style={styles.input}
                    placeholder="Organization name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Plan"
                    value={isPlatformAdmin ? newOrgPlan : "standard"}
                    onChange={(e) => setNewOrgPlan(e.target.value)}
                    disabled={!isPlatformAdmin}
                    aria-label={
                      isPlatformAdmin
                        ? "Organization plan"
                        : "Sub-organization plan is fixed to standard"
                    }
                  />
                  <select
                    style={styles.input}
                    value={isPlatformAdmin ? newOrgParentOrganizationId : user.organizationId || 0}
                    onChange={(e) => setNewOrgParentOrganizationId(Number(e.target.value))}
                    disabled={!isPlatformAdmin}
                  >
                    <option value={0}>
                      {isPlatformAdmin ? "Top-level organization" : "Select parent organization"}
                    </option>
                    {(isPlatformAdmin
                      ? organizations
                      : organizations.filter((organization) => organization.id === user.organizationId)
                    ).map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-grid" style={{ ...styles.row, marginBottom: 12 }}>
                  <input
                    style={styles.input}
                    type="email"
                    placeholder="Admin email"
                    value={newOrgAdminEmail}
                    onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Admin username"
                    value={newOrgAdminUsername}
                    onChange={(e) => setNewOrgAdminUsername(e.target.value)}
                  />
                  <PasswordInput
                    placeholder="Admin password"
                    value={newOrgAdminPassword}
                    onChange={(e) => setNewOrgAdminPassword(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Admin full name"
                    value={newOrgAdminName}
                    onChange={(e) => setNewOrgAdminName(e.target.value)}
                  />
                </div>

                <button style={styles.button} onClick={handleCreateOrganization}>
                  {isPlatformAdmin ? "Create Organization" : "Create Sub-Organization"}
                </button>
                </>
                ) : (
                  <>
                    <h4 style={{ ...styles.title, marginBottom: 10 }}>Sub Organizations</h4>
                    <input
                      style={{ ...styles.input, marginBottom: 12 }}
                      value={currentSubscription?.planName || ownOrganization?.plan || "-"}
                      disabled
                      aria-label="Current tenant plan"
                    />
                    <input
                      style={{ ...styles.input, marginBottom: 12 }}
                      value={ownOrganization?.active ? "active" : "inactive"}
                      disabled
                      aria-label="Current tenant status"
                    />
                    <div style={styles.small}>
                      Existing sub-organizations are listed here. New sub-organization creation is available only for enterprise parent tenants.
                    </div>
                  </>
                )}
              </div>

              <div className="admin-main-panel">
              {(isPlatformAdmin ? organizations : subOrganizations).length === 0 ? (
                <div style={styles.small}>
                  {isPlatformAdmin ? "No organizations found." : "No sub-organizations found."}
                </div>
              ) : (
                <div className="compact-list" aria-label="Organizations list">
                  {(isPlatformAdmin ? organizations : subOrganizations).map((organization) => {
                    const pendingAdmins = organization.admins.filter(
                      (admin) => admin.approvalStatus === "pending"
                    );
                    const rowKey = `organization-${organization.id}`;
                    const isOpen = isExpandedRow(rowKey);

                    return (
                      <div
                        key={organization.id}
                        className={`compact-row organization-row ${isOpen ? "compact-row-open" : ""}`}
                      >
                        <div className="compact-row-main">
                          <button
                            type="button"
                            className="compact-row-toggle"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} organization details`}
                      onClick={() => toggleExpandedRow(rowKey)}
                          >
                            {isOpen ? "-" : "+"}
                          </button>
                          <div className="compact-row-title">
                            <strong>{organization.name}</strong>
                            <span>
                              {organization.plan} plan
                              {organization.parentOrganizationName
                                ? ` | parent: ${organization.parentOrganizationName}`
                                : " | top-level"}
                              {pendingAdmins.length > 0
                                ? ` | ${pendingAdmins.length} admin approval waiting`
                                : ""}
                            </span>
                          </div>
                        </div>
                        <div className="compact-row-meta">
                          <span>{organization.active ? "active" : "inactive"}</span>
                          <span>{organization.userCount} users</span>
                          <span>{organization.reportCount} reports</span>
                        </div>
                        <div className="compact-row-actions organization-row-actions">
                          <div className="organization-stats">
                            <div>
                              <strong>{organization.userCount}</strong>
                              <span>Users</span>
                            </div>
                            <div>
                              <strong>{organization.adminCount}</strong>
                              <span>Admins</span>
                            </div>
                            <div>
                              <strong>{organization.inspectorCount}</strong>
                              <span>Inspectors</span>
                            </div>
                            <div>
                              <strong>{organization.reportCount}</strong>
                              <span>Reports</span>
                            </div>
                          </div>

                          <div className="organization-admins organization-primary-admins">
                            <div className="organization-admins-title">Organization Admins</div>
                            {organization.admins.length === 0 ? (
                              <div style={styles.small}>No admin user yet.</div>
                            ) : (
                              organization.admins.map((admin) => (
                                <div key={admin.id} className="organization-admin-row">
                                  <div className="compact-row-title">
                                    <strong>{admin.name}</strong>
                                    <span>
                                      {admin.email || "No email"} | {admin.username} | {admin.approvalStatus}
                                      {admin.active === false ? " | inactive" : ""}
                                    </span>
                                  </div>
                                  {admin.approvalStatus === "pending" ? (
                                    <div className="organization-admin-actions">
                                      <button
                                        style={styles.button}
                      onClick={() => handleApproveOrganizationAdmin(admin)}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        style={styles.secondaryButton}
                      onClick={() => handleDeleteUser(admin.id)}
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      style={styles.removeButton}
                      onClick={() => handleDeleteUser(admin.id)}
                                      disabled={admin.id === user.id}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>

                          <div className="organization-admins organization-member-list">
                            <div className="organization-admins-title">Admin & User List</div>
                            {(organization.users || []).length === 0 ? (
                              <div style={styles.small}>No users registered yet.</div>
                            ) : (
                              (organization.users || []).map((member) => (
                                <div key={member.id} className="organization-admin-row">
                                  <div className="compact-row-title">
                                    <strong>{member.name}</strong>
                                    <span>
                                      {member.email || "No email"} | {member.username} | {member.role}
                                      {" | "}
                                      {member.approvalStatus || "approved"}
                                      {member.active === false ? " | inactive" : ""}
                                      {" | Password stored securely"}
                                    </span>
                                  </div>
                                  <button
                                    style={styles.removeButton}
                      onClick={() => handleDeleteUser(member.id)}
                                    disabled={member.id === user.id}
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="organization-tenant-actions">
                            {isPlatformAdmin ? (
                              <button
                                style={
                                  organization.active
                                    ? { ...styles.button, background: "#b91c1c" }
                                    : styles.button
                                }
                      onClick={() => handleToggleOrganization(organization)}
                              >
                                {organization.active ? "Deactivate" : "Activate"}
                              </button>
                            ) : (
                              <div style={styles.small}>
                                Tenant status: {organization.active ? "active" : "inactive"}
                              </div>
                            )}
                            <button
                              style={styles.removeButton}
                      onClick={() => handleDeleteOrganization(organization)}
                              disabled={organization.id === user.organizationId}
                            >
                              Delete Organization
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
              </div>
            </div>
          ) : null}

          {activeAdminPage === "organizationUsers" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Organization &gt; User</h3>
                  <p>All organization users listed with their email addresses.</p>
                </div>
              </div>

              {organizationUserRows.length === 0 ? (
                <div style={styles.small}>No organization users found.</div>
              ) : (
                <div className="compact-list" aria-label="Organization users list">
                  <div className="compact-row organization-users-row organization-users-header">
                    <div className="compact-row-title">
                      <strong>Organization</strong>
                    </div>
                    <div className="compact-row-title">
                      <strong>User</strong>
                    </div>
                    <div className="compact-row-title">
                      <strong>E-Mail Address</strong>
                    </div>
                    <div className="compact-row-title">
                      <strong>Action</strong>
                    </div>
                  </div>

                  {organizationUserRows
                    .slice(
                      getVisibleListStart("organization-users"),
                      getVisibleListCount("organization-users")
                    )
                    .map((row) => (
                    <div key={row.id} className="compact-row organization-users-row">
                      <div className="compact-row-title">
                        <strong>{row.organizationName}</strong>
                      </div>
                      <div className="compact-row-title">
                        <span>{row.userName}</span>
                      </div>
                      <div className="compact-row-title">
                        <span>{row.email}</span>
                      </div>
                      <div className="compact-row-title">
                        <button
                          style={styles.removeButton}
                      onClick={() => handleDeleteUser(row.id)}
                          disabled={row.id === user.id}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  <ShowMoreButton
                    visibleCount={getVisibleListCount("organization-users")}
                    totalCount={organizationUserRows.length}
                    onBack={() => goBackListItems("organization-users")}
                      onClick={() => showMoreListItems("organization-users")}
                  />
                </div>
              )}
            </div>
          ) : null}

          {activeAdminPage === "billing" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Billing & Subscription</h3>
                  <p>
                    {isPlatformAdmin
                      ? "Review usage, choose plans, activate subscriptions, and audit billing history."
                      : "Review your tenant status and current plan details."}
                  </p>
                </div>
              </div>

              <div
                className="billing-summary-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                  <div style={styles.small}>Current Subscription</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {currentSubscription ? currentSubscription.planName : "No active subscription"}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {currentSubscription
                      ? `${formatMoney(
                          currentSubscription.amountCents,
                          currentSubscription.currency
                        )} / ${currentSubscription.billingCycle}`
                      : isPlatformAdmin
                        ? "Select a plan to start or renew."
                        : "No active subscription assigned."}
                  </div>
                  <div style={{ ...styles.small, marginTop: 8 }}>
                    Status: {currentSubscription?.status || "-"}
                  </div>
                  <div style={{ ...styles.small, marginTop: 4 }}>
                    End / renewal date: {formatDateTime(currentSubscription?.renewsAt)}
                  </div>
                </div>

                <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                  <div style={styles.small}>Users</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {billingUsage?.userCount ?? 0}
                    {" / "}
                    {currentSubscription
                      ? formatLimit(currentSubscription.userLimit, "users").replace(" users", "")
                      : "-"}
                  </div>
                  <div style={{ ...styles.small, marginTop: 8 }}>
                    Active users allowed by the selected subscription.
                  </div>
                </div>

                <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                  <div style={styles.small}>Templates</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {billingUsage?.templateCount ?? 0}
                    {" / "}
                    {currentSubscription
                      ? formatLimit(currentSubscription.checklistLimit, "templates").replace(
                          " templates",
                          ""
                        )
                      : "-"}
                  </div>
                  <div style={{ ...styles.small, marginTop: 8 }}>
                    Checklist templates included in the current plan.
                  </div>
                </div>

                <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                  <div style={styles.small}>Retention</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
                    {currentSubscription
                      ? `${currentSubscription.reportRetentionDays} days`
                      : "-"}
                  </div>
                  <div style={{ ...styles.small, marginTop: 8 }}>
                    Report retention included in this subscription.
                  </div>
                </div>
              </div>

              <div className="admin-two-column billing-layout">
                <div className="admin-side-panel billing-controls-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
              {!isPlatformAdmin && canCreateSubOrganizations ? (
                <>
                  <h4 style={{ ...styles.title, marginBottom: 10 }}>Tenant Status</h4>
                  <input
                    style={{ ...styles.input, marginBottom: 12 }}
                    value={currentSubscription?.planName || ownOrganization?.plan || "-"}
                    disabled
                    aria-label="Current tenant plan"
                  />
                  <input
                    style={{ ...styles.input, marginBottom: 12 }}
                    value={currentSubscription?.status || (ownOrganization?.active ? "active" : "inactive")}
                    disabled
                    aria-label="Current tenant status"
                  />
                  <div style={styles.small}>
                    Plan and tenant status changes are managed by the platform admin.
                  </div>
                </>
              ) : null}

              {isPlatformAdmin ? (
              <>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Activate Subscription</h4>
                <div className="admin-form-grid" style={{ ...styles.row, marginBottom: 12 }}>
                  <select
                    style={styles.input}
                    value={billingOrganizationId}
                    onChange={(e) => setBillingOrganizationId(Number(e.target.value))}
                  >
                    <option value={0}>Select organization</option>
                    {organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                  <select
                    style={styles.input}
                    value={billingPlanId}
                    onChange={(e) => setBillingPlanId(Number(e.target.value))}
                  >
                    <option value={0}>Select plan</option>
                    {billing.plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                  <select
                    style={styles.input}
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div style={{ ...styles.small, marginBottom: 12 }}>
                  Every plan starts with a 7-day trial. Billing begins after the trial period.
                </div>
                <div className="admin-form-grid" style={{ ...styles.row, marginBottom: 12 }}>
                  <input
                    style={styles.input}
                    placeholder="Payment method / invoice note"
                    value={billingPaymentMethod}
                    onChange={(e) => setBillingPaymentMethod(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="External customer ID"
                    value={billingExternalCustomerId}
                    onChange={(e) => setBillingExternalCustomerId(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="External subscription ID"
                    value={billingExternalSubscriptionId}
                    onChange={(e) => setBillingExternalSubscriptionId(e.target.value)}
                  />
                </div>
                <button style={styles.button} onClick={handleActivateSubscription}>
                  Activate Subscription
                </button>
              </>
              ) : null}
                </div>

                <div className="admin-main-panel">
              <div
                className="billing-plan-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                {billing.plans.map((plan) => (
                  <div
                    key={plan.id}
                    style={{
                      ...styles.section,
                      background: plan.id === billingPlanId ? "#eff6ff" : "#fff",
                      border: plan.id === billingPlanId ? "1px solid #2563eb" : "1px solid #e5e7eb",
                      marginTop: 0,
                    }}
                  >
                    <strong>{plan.name}</strong>
                    <div style={{ ...styles.small, marginTop: 6 }}>{plan.description}</div>
                    <div style={{ marginTop: 10, fontWeight: 700 }}>
                      {formatMoney(plan.monthlyPriceCents)} monthly |{" "}
                      {formatMoney(plan.yearlyPriceCents)} yearly
                    </div>
                    <div style={{ ...styles.small, marginTop: 8 }}>
                      {formatLimit(plan.userLimit, "users")} |{" "}
                      {formatLimit(plan.checklistLimit, "checklists")} |{" "}
                      {plan.reportRetentionDays} days retention
                    </div>
                    {isPlatformAdmin ? (
                      <button
                        type="button"
                        style={{ ...styles.secondaryButton, marginTop: 10 }}
                      onClick={() => setBillingPlanId(plan.id)}
                      >
                        Select
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              {isPlatformAdmin ? (
              <div style={{ marginTop: 14 }}>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Subscription History</h4>
                {billing.subscriptions.length === 0 ? (
                  <div style={styles.small}>No subscriptions found.</div>
                ) : (
                  billing.subscriptions.map((subscription) => (
                    <div key={subscription.id} style={{ ...styles.section, background: "#fff" }}>
                      <div
                        style={{
                          ...styles.row,
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <strong>{subscription.organizationName}</strong>
                          <div style={styles.small}>
                            {subscription.planName} | {subscription.status} |{" "}
                            {formatMoney(subscription.amountCents, subscription.currency)} /{" "}
                            {subscription.billingCycle}
                          </div>
                          <div style={{ ...styles.small, marginTop: 4 }}>
                            Renews: {formatDateTime(subscription.renewsAt)} | Payment:{" "}
                            {subscription.paymentMethod}
                          </div>
                          {subscription.externalSubscriptionId ? (
                            <div style={{ ...styles.small, marginTop: 4 }}>
                              External subscription: {subscription.externalSubscriptionId}
                            </div>
                          ) : null}
                        </div>
                        {subscription.status !== "canceled" ? (
                          <button
                            type="button"
                            style={{ ...styles.button, background: "#b91c1c" }}
                      onClick={() => handleCancelSubscription(subscription.id)}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
              ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeAdminPage === "templates" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Templates</h3>
                  <p>Create reusable checklist templates, import questions, manage images, and edit sections.</p>
                </div>
              </div>

              <div className="admin-two-column templates-layout">
          <div className="admin-main-panel template-builder-panel" style={styles.section}>
            <h3 style={styles.title}>
              {editingId ? "Edit Checklist Template" : "Create Checklist Template"}
            </h3>

            <input
              style={{ ...styles.input, marginBottom: 12 }}
              placeholder="Checklist display title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div
              style={{ ...styles.section, background: "#fff", marginTop: 0, marginBottom: 12 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleImportQuestionsFromExcel(e.dataTransfer.files?.[0] || null);
              }}
            >
              <label style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>
                Import Checklist from Excel
              </label>
              <label className="file-upload-button">
                <span>Choose File</span>
                <input
                  id="question-import-file"
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => {
                    handleImportQuestionsFromExcel(e.target.files?.[0] || null);
                    e.target.value = "";
                  }}
                />
              </label>
              <div style={{ ...styles.small, marginTop: 8 }}>
                Use .xlsx or .csv files only. Macro-enabled and legacy Excel files are blocked.
                AI reviews the sheet, creates sections, and turns each checklist row into one
                question. You can also drag and drop the file here.
              </div>
            </div>

            <div
              style={{ ...styles.section, background: "#fff", marginTop: 0, marginBottom: 12 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleTemplateImageUpload(e.dataTransfer.files);
              }}
            >
              <label style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>
                Template Image
              </label>
              <label className="file-upload-button">
                <span>Choose File</span>
                <input
                  id="template-image-file"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    handleTemplateImageUpload(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {templateImageUploading ? (
                <div style={{ ...styles.small, marginTop: 8 }}>Uploading image...</div>
              ) : null}
              <div style={{ ...styles.small, marginTop: 8 }}>
                You can also drag and drop an image here.
              </div>
              {templateImagePath ? (
                <div style={{ marginTop: 12 }}>
                  {templateImageLoadError ? (
                    <div style={{ ...styles.small, color: "#8a4b12" }}>
                      Template image could not be previewed. Save the template or upload the image again.
                    </div>
                  ) : (
                    <img
                      src={resolveFileUrl(templateImagePath)}
                      alt="Template"
                      onError={() => setTemplateImageLoadError(true)}
                      style={{
                        width: "25%",
                        minWidth: 120,
                        maxWidth: 220,
                        height: "auto",
                        objectFit: "contain",
                        borderRadius: 10,
                        border: "1px solid #d7e6e4",
                        display: "block",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    style={{ ...styles.secondaryButton, marginTop: 10 }}
                      onClick={() => setTemplateImagePath("")}
                  >
                    Remove Image
                  </button>
                </div>
              ) : null}
            </div>

            {sections.map((section, sectionIndex) => (
              <div key={sectionIndex} style={{ ...styles.section, background: "#fff" }}>
                <div style={{ ...styles.row, marginBottom: 10 }}>
                  <button
                    style={styles.secondaryButton}
                      onClick={() => moveSection(sectionIndex, -1)}
                    disabled={sectionIndex === 0}
                  >
                    Move Section Up
                  </button>
                  <button
                    style={styles.secondaryButton}
                      onClick={() => moveSection(sectionIndex, 1)}
                    disabled={sectionIndex === sections.length - 1}
                  >
                    Move Section Down
                  </button>
                </div>

                <input
                  style={{ ...styles.input, marginBottom: 10 }}
                  placeholder={`Section ${sectionIndex + 1} title`}
                  value={section.title}
                  onChange={(e) => updateSectionTitle(sectionIndex, e.target.value)}
                />

                {section.items.map((item, questionIndex) => (
                  <div
                    key={questionIndex}
                    style={{
                      ...styles.questionEditRow,
                      opacity:
                        draggedQuestion?.sectionIndex === sectionIndex &&
                        draggedQuestion?.questionIndex === questionIndex
                          ? 0.55
                          : 1,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={() => handleQuestionDrop(sectionIndex, questionIndex)}
                  >
                    <div
                      draggable
                      role="button"
                      tabIndex={0}
                      title="Drag to reorder"
                      aria-label="Drag question to reorder"
                      style={{
                        ...styles.questionDragHandle,
                        ...(draggedQuestion?.sectionIndex === sectionIndex &&
                        draggedQuestion?.questionIndex === questionIndex
                          ? styles.questionDragHandleActive
                          : {}),
                      }}
                      onDragStart={(e) => {
                        setDraggedQuestion({ sectionIndex, questionIndex });
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(
                          "text/plain",
                          `${sectionIndex}:${questionIndex}`
                        );
                      }}
                      onDragEnd={() => setDraggedQuestion(null)}
                    >
                      ::
                    </div>
                    <div>
                      <input
                        style={{ ...styles.input, marginBottom: 8 }}
                        placeholder={`Question ${questionIndex + 1}`}
                        value={item.question}
                        onChange={(e) =>
                          updateQuestion(sectionIndex, questionIndex, e.target.value)
                        }
                      />
                      <select
                        style={{ ...styles.input, marginBottom: 8 }}
                        value={item.answerType}
                        onChange={(e) =>
                          updateQuestionAnswerType(
                            sectionIndex,
                            questionIndex,
                            e.target.value as AnswerType
                          )
                        }
                      >
                        {(Object.keys(ANSWER_TYPE_LABELS) as AnswerType[]).map((type) => (
                          <option key={type} value={type}>
                            {ANSWER_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>

                      {["MULTIPLE_CHOICE", "RADIO_BUTTON"].includes(item.answerType) ? (
                        <div style={{ ...styles.section, marginTop: 0, background: "#f5fbfa" }}>
                          <div style={{ ...styles.small, marginBottom: 8 }}>
                            Answer options
                          </div>
                          {item.options.map((option, optionIndex) => (
                            <div
                              key={optionIndex}
                              style={{ ...styles.row, marginBottom: 8, alignItems: "center" }}
                            >
                              <input
                                style={{ ...styles.input, flex: 1 }}
                                placeholder={`Option ${optionIndex + 1}`}
                                value={option}
                                onChange={(e) =>
                                  updateQuestionOption(
                                    sectionIndex,
                                    questionIndex,
                                    optionIndex,
                                    e.target.value
                                  )
                                }
                              />
                              <button
                                type="button"
                                style={styles.secondaryButton}
                      onClick={() =>
                                  removeQuestionOption(
                                    sectionIndex,
                                    questionIndex,
                                    optionIndex
                                  )
                                }
                                disabled={item.options.length === 1}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            style={styles.secondaryButton}
                      onClick={() => addQuestionOption(sectionIndex, questionIndex)}
                          >
                            Add Option
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      title="Delete question"
                      aria-label="Delete question"
                      style={styles.iconButton}
                      onClick={() => removeQuestionFromSection(sectionIndex, questionIndex)}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                  </div>
                ))}

                <button
                  style={styles.secondaryButton}
                      onClick={() => addQuestionToSection(sectionIndex)}
                >
                  Add Question
                </button>
              </div>
            ))}

            <div style={{ ...styles.row, marginTop: 12 }}>
              <button style={styles.secondaryButton} onClick={addSection}>
                Add Section
              </button>
              {editingId ? (
                <button style={styles.secondaryButton} onClick={resetTemplateForm}>
                  Cancel Edit
                </button>
              ) : null}
              <button style={styles.button} onClick={saveChecklist}>
                {editingId ? "Update Checklist" : "Save Checklist"}
              </button>
            </div>
          </div>

          <div className="admin-side-panel template-list-panel" style={styles.section}>
            <h3 style={styles.title}>Templates</h3>

            {checklists.length === 0 ? (
              <div style={styles.small}>No templates found.</div>
            ) : (
              <div className="compact-list">
                {checklists
                  .slice(getVisibleListStart("templates"), getVisibleListCount("templates"))
                  .map((c) => {
                  const rowKey = `template-${c.id}`;
                  const isOpen = isExpandedRow(rowKey);
                  const sectionCount = Array.isArray(c.sections) ? c.sections.length : 0;
                  const questionCount = Array.isArray(c.sections)
                    ? c.sections.reduce((total, section) => total + section.items.length, 0)
                    : 0;
                  const shareForm = shareForms[c.id] || {
                    open: false,
                    email: "",
                    sending: false,
                  };

                  return (
                    <div
                      key={c.id}
                      className={`compact-row template-row ${isOpen ? "compact-row-open" : ""}`}
                    >
                      <div className="compact-row-main">
                        <button
                          type="button"
                          className="compact-row-toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} template actions`}
                      onClick={() => toggleExpandedRow(rowKey)}
                        >
                          {isOpen ? "-" : "+"}
                        </button>
                        <div className="compact-row-title">
                          <strong>{c.title}</strong>
                          <span>{sectionCount} sections | {questionCount} questions</span>
                        </div>
                      </div>
                      <div className="compact-row-meta">
                        <span>{sectionCount} sections</span>
                        <span>{questionCount} questions</span>
                      </div>
                      <div className="template-row-primary-actions">
                        <button
                          style={styles.secondaryButton}
                      onClick={() => startEditTemplate(c)}
                        >
                          Edit
                        </button>
                        <button
                          style={styles.secondaryButton}
                      onClick={() => handleDuplicateTemplate(c)}
                        >
                          Copy
                        </button>
                        <button
                          style={styles.secondaryButton}
                          onClick={() => toggleTemplateShareForm(c.id)}
                        >
                          Share
                        </button>
                        <button
                          style={styles.secondaryButton}
                          onClick={() => handleShareTemplateWithCommunity(c)}
                        >
                          Share With Community
                        </button>
                        <button
                          style={{ ...styles.button, background: "#b91c1c" }}
                          onClick={() => handleDeleteTemplate(c.id)}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="compact-row-actions template-row-actions">
                        <div className="template-summary-strip">
                          <span>{sectionCount} sections</span>
                          <span>{questionCount} questions</span>
                        </div>

                        <div className="template-detail-actions">
                          {shareForm.open ? (
                            <div className="template-share-form">
                              <input
                                type="email"
                                style={styles.input}
                                placeholder="Recipient email"
                                value={shareForm.email}
                                onChange={(event) =>
                                  updateTemplateShareEmail(c.id, event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    handleShareTemplate(c);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                style={styles.button}
                      onClick={() => handleShareTemplate(c)}
                                disabled={shareForm.sending}
                              >
                                {shareForm.sending ? "Sending..." : "Send"}
                              </button>
                            </div>
                          ) : null}
                          <button
                            style={{ ...styles.button, background: "#b91c1c" }}
                      onClick={() => handleForceDeleteTemplate(c.id)}
                          >
                            Force Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <ShowMoreButton
                  visibleCount={getVisibleListCount("templates")}
                  totalCount={checklists.length}
                  onBack={() => goBackListItems("templates")}
                      onClick={() => showMoreListItems("templates")}
                />
              </div>
            )}
          </div>
              </div>
            </div>
          ) : null}

          {activeAdminPage === "communityTemplates" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>Community Templates</h3>
                  <p>Templates shared by Inspectria users. Using one copies it into your organization before you edit or complete it.</p>
                </div>
              </div>

              {communityTemplates.length === 0 ? (
                <div style={styles.small}>No community templates have been shared yet.</div>
              ) : (
                <div className="compact-list">
                  {communityTemplates
                    .slice(
                      getVisibleListStart("community-templates"),
                      getVisibleListCount("community-templates")
                    )
                    .map((checklist) => {
                      const sectionCount = Array.isArray(checklist.sections) ? checklist.sections.length : 0;
                      const questionCount = Array.isArray(checklist.sections)
                        ? checklist.sections.reduce((total, section) => total + section.items.length, 0)
                        : 0;
                      const sharedBy = checklist.sharedByName || checklist.sharedByUsername || "Inspectria user";

                      return (
                        <div key={checklist.communityTemplateId || checklist.id} className="compact-row compact-row-open">
                          <div className="compact-row-main">
                            <div className="compact-row-title">
                              <strong>{checklist.title}</strong>
                              <span>
                                Shared by {sharedBy}
                                {checklist.sharedByOrganizationName ? ` | ${checklist.sharedByOrganizationName}` : ""}
                              </span>
                            </div>
                          </div>
                          <div className="compact-row-meta">
                            <span>{sectionCount} sections</span>
                            <span>{questionCount} questions</span>
                          </div>
                          <div className="compact-row-actions">
                            <button
                              type="button"
                              style={styles.button}
                              onClick={() => openCommunityTemplate(checklist)}
                              disabled={startingTemplateId === checklist.id}
                            >
                              {startingTemplateId === checklist.id ? "Opening..." : "Use Template"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  <ShowMoreButton
                    visibleCount={getVisibleListCount("community-templates")}
                    totalCount={communityTemplates.length}
                    onBack={() => goBackListItems("community-templates")}
                    onClick={() => showMoreListItems("community-templates")}
                  />
                </div>
              )}
            </div>
          ) : null}

          {activeAdminPage === "myWork" ? (
            <div className="admin-page-panel" style={styles.section}>
              <div className="admin-panel-heading">
                <div>
                  <h3 style={styles.title}>My Work</h3>
                  <p>Fill templates assigned to you or start any template from your organization.</p>
                </div>
              </div>

              {activeAssignment && activeChecklist ? (
                <div style={styles.section}>
                  <div style={styles.row}>
                    <button type="button" style={styles.secondaryButton} onClick={saveAndContinueLater}>
                      Back to My Work
                    </button>
                  </div>

                  <h3 style={styles.title}>{activeChecklist.title}</h3>
                  <div style={{ ...styles.small, marginBottom: 12 }}>
                    Overall progress: {checklistProgress.answered}/{checklistProgress.total} answered ({checklistProgress.percent}%)
                  </div>

                  {activeChecklist.image_path || activeChecklist.imagePath ? (
                    <img
                      src={resolveFileUrl(activeChecklist.image_path || activeChecklist.imagePath || "")}
                      alt={activeChecklist.title}
                      style={{
                        maxWidth: "100%",
                        maxHeight: 260,
                        objectFit: "contain",
                        borderRadius: 12,
                        marginBottom: 16,
                      }}
                    />
                  ) : null}

                  <div style={{ ...styles.row, marginBottom: 12 }}>
                    {activeChecklist.sections.map((section, index) => (
                      <button
                        key={section.id}
                        type="button"
                        style={index === activeSectionIndex ? styles.button : styles.secondaryButton}
                      onClick={() => goToSection(index)}
                      >
                        {index + 1}. {section.title}
                      </button>
                    ))}
                  </div>

                  {activeSection ? (
                    <>
                      <div style={{ ...styles.small, marginBottom: 12 }}>
                        Section progress: {activeSectionProgress.answered}/{activeSectionProgress.total} answered ({activeSectionProgress.percent}%)
                      </div>
                      <div key={activeSection.id} style={styles.section}>
                        {activeSection.items.map((item, index) => (
                          <div
                            key={item.id}
                            ref={(element) => {
                              questionRefs.current[item.id] = element;
                            }}
                            style={{ ...styles.section, background: "#fff" }}
                          >
                            <strong>
                              {index + 1}. {item.question}
                            </strong>

                            {(item.answerType || item.answer_type || "FORMAT1") === "FORMAT1" ? (
                              <div style={{ ...styles.row, marginTop: 10 }}>
                                {(["YES", "NO", "N/A"] as const).map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    style={getAnswerButtonStyle(value, form[item.id]?.answer || "")}
                      onClick={() => updateAnswer(item.id, value)}
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            {(item.answerType || item.answer_type) === "DATE" ? (
                              <div style={{ marginTop: 10 }}>
                                <input
                                  type="date"
                                  style={styles.input}
                                  value={form[item.id]?.answer || ""}
                                  onChange={(event) => updateAnswer(item.id, event.target.value)}
                                />
                              </div>
                            ) : null}

                            {(item.answerType || item.answer_type) === "TEXT" ? (
                              <div style={{ marginTop: 10 }}>
                                <textarea
                                  style={{ ...styles.input, minHeight: 90 }}
                                  placeholder="Answer"
                                  value={form[item.id]?.answer || ""}
                                  onChange={(event) => updateAnswer(item.id, event.target.value)}
                                />
                              </div>
                            ) : null}

                            {(item.answerType || item.answer_type) === "MULTIPLE_CHOICE" ? (
                              <div style={{ marginTop: 10 }}>
                                <select
                                  style={styles.input}
                                  value={form[item.id]?.answer || ""}
                                  onChange={(event) => updateAnswer(item.id, event.target.value)}
                                >
                                  <option value="">Select option</option>
                                  {(item.options || []).map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            {(item.answerType || item.answer_type) === "RADIO_BUTTON" ? (
                              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                {(item.options || []).map((option) => {
                                  const selectedAnswers = (form[item.id]?.answer || "")
                                    .split(",")
                                    .map((value) => value.trim())
                                    .filter(Boolean);
                                  const isChecked = selectedAnswers.includes(option);

                                  return (
                                    <label
                                      key={option}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "10px 12px",
                                        border: "1px solid #d1d5db",
                                        borderRadius: 10,
                                        background: isChecked ? "#e6f3f1" : "#fff",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        name={`admin-question-${item.id}`}
                                        value={option}
                                        checked={isChecked}
                                        onChange={() => toggleMultiAnswer(item.id, option)}
                                      />
                                      <span>{option}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : null}

                            <div style={{ marginTop: 10 }}>
                              <textarea
                                style={{ ...styles.input, minHeight: 80 }}
                                placeholder="Comment"
                                value={form[item.id]?.comment || ""}
                                onChange={(event) => updateComment(item.id, event.target.value)}
                              />
                            </div>

                            <div
                              style={{ marginTop: 12 }}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleAddPhotos(item.id, event.dataTransfer.files);
                              }}
                            >
                              <label
                                htmlFor={`admin-photo-upload-${item.id}`}
                                style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
                              >
                                Add Photos
                              </label>
                              <label className="file-upload-button" htmlFor={`admin-photo-upload-${item.id}`}>
                                <span>Choose File</span>
                                <input
                                  id={`admin-photo-upload-${item.id}`}
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(event) => {
                                    handleAddPhotos(item.id, event.target.files);
                                    event.currentTarget.value = "";
                                  }}
                                />
                              </label>
                              {uploadingItemId === item.id ? (
                                <div style={{ marginTop: 8, color: "#0f766e", fontSize: 13 }}>
                                  Uploading photos...
                                </div>
                              ) : null}
                              <div style={{ ...styles.small, marginTop: 8 }}>
                                You can also drag and drop photos here.
                              </div>
                            </div>

                            {form[item.id]?.photos?.length > 0 ? (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                  gap: 12,
                                  marginTop: 12,
                                }}
                              >
                                {form[item.id].photos.map((photo, photoIndex) => {
                                  const src = resolveFileUrl(photo);

                                  return (
                                    <div
                                      key={photoIndex}
                                      style={{
                                        border: "1px solid #d7e6e4",
                                        borderRadius: 12,
                                        padding: 10,
                                        background: "#fbfefd",
                                      }}
                                    >
                                      <img
                                        src={src}
                                        alt={`uploaded-${photoIndex}`}
                                        style={{
                                          width: "100%",
                                          height: 110,
                                          objectFit: "cover",
                                          borderRadius: 10,
                                          display: "block",
                                        }}
                                      />
                                      <button
                                        type="button"
                                        style={{
                                          background: "#dc2626",
                                          color: "#fff",
                                          border: "none",
                                          padding: "6px 10px",
                                          borderRadius: 8,
                                          cursor: "pointer",
                                          marginTop: 8,
                                          fontSize: 12,
                                        }}
                      onClick={() => removePhoto(item.id, photoIndex)}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}

                  <div style={styles.row}>
                    <button type="button" style={styles.secondaryButton} onClick={saveAndContinueLater}>
                      Cancel
                    </button>
                    <button type="button" style={styles.secondaryButton} onClick={saveAndContinueLater}>
                      Save and Continue Later
                    </button>
                    {!isFirstSection ? (
                      <button
                        type="button"
                        style={styles.secondaryButton}
                      onClick={() => goToSection(activeSectionIndex - 1)}
                      >
                        Previous Section
                      </button>
                    ) : null}
                    {!isLastSection ? (
                      <button
                        type="button"
                        style={styles.button}
                      onClick={() => goToSection(activeSectionIndex + 1)}
                      >
                        Next Section
                      </button>
                    ) : (
                      <button type="button" style={styles.button} onClick={submitChecklist}>
                        Complete Checklist
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="admin-two-column assignments-layout">
                  <div className="admin-side-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                    <h4 style={{ ...styles.title, marginBottom: 10 }}>My Assignments</h4>
                    {myAssignedAssignments.length === 0 ? (
                      <div style={styles.small}>No active assignments assigned to you.</div>
                    ) : (
                      <>
                        {myAssignedAssignments
                          .slice(
                            getVisibleListStart("my-assignments"),
                            getVisibleListCount("my-assignments")
                          )
                          .map((assignment) => (
                            <div key={assignment.id} style={{ ...styles.section, background: "#fbfefd" }}>
                              <strong>{assignment.checklistTitle}</strong>
                              <br />
                              Assigned By: {assignment.assignedByName}
                              <br />
                              <button
                                type="button"
                                style={{ ...styles.button, marginTop: 10 }}
                      onClick={() => openAssignment(assignment)}
                              >
                                Open Checklist
                              </button>
                            </div>
                          ))}
                        <ShowMoreButton
                          visibleCount={getVisibleListCount("my-assignments")}
                          totalCount={myAssignedAssignments.length}
                          onBack={() => goBackListItems("my-assignments")}
                      onClick={() => showMoreListItems("my-assignments")}
                        />
                      </>
                    )}
                  </div>

                  <div className="admin-main-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                    <h4 style={{ ...styles.title, marginBottom: 10 }}>Available Templates</h4>
                    <div style={styles.small}>
                      Choose any template created for your organization and complete it without waiting for an assignment.
                    </div>

                    {checklists.length === 0 ? (
                      <div style={{ ...styles.small, marginTop: 12 }}>No templates are available for your organization.</div>
                    ) : (
                      <div className="compact-list" style={{ marginTop: 12 }}>
                        {checklists
                          .slice(
                            getVisibleListStart("my-work-templates"),
                            getVisibleListCount("my-work-templates")
                          )
                          .map((checklist) => {
                          const hasOpenDraft = selfStartedChecklistIds.has(checklist.id);

                          return (
                            <div key={checklist.id} className="compact-row compact-row-open">
                              <div className="compact-row-main">
                                <div className="compact-row-title">
                                  <strong>{checklist.title}</strong>
                                  {hasOpenDraft ? (
                                    <span>You have an open draft for this template.</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="compact-row-actions">
                                <button
                                  type="button"
                                  style={styles.button}
                                  onClick={() => openTemplate(checklist)}
                                  disabled={startingTemplateId === checklist.id}
                                >
                                  {startingTemplateId === checklist.id
                                    ? "Opening Template..."
                                    : hasOpenDraft
                                      ? "Continue Template"
                                      : "Fill Template"}
                                </button>
                                <button
                                  type="button"
                                  style={styles.secondaryButton}
                                  onClick={() => handleShareTemplateWithCommunity(checklist)}
                                >
                                  Share With Community
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <ShowMoreButton
                          visibleCount={getVisibleListCount("my-work-templates")}
                          totalCount={checklists.length}
                          onBack={() => goBackListItems("my-work-templates")}
                      onClick={() => showMoreListItems("my-work-templates")}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {activeAdminPage === "assignments" ? (
          <div className="admin-page-panel" style={styles.section}>
            <div className="admin-panel-heading">
              <div>
                <h3 style={styles.title}>Assignments</h3>
                <p>Assign checklist work and review open or completed assignment ownership.</p>
              </div>
            </div>

            <div className="admin-two-column assignments-layout">
            <div className="admin-side-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
            <h4 style={{ ...styles.title, marginBottom: 10 }}>Create Assignment</h4>
            <div className="admin-form-grid" style={{ ...styles.row, marginBottom: 12 }}>
              <select
                style={styles.input}
                value={selectedChecklistId}
                onChange={(e) => setSelectedChecklistId(Number(e.target.value))}
              >
                <option value={0}>Select checklist</option>
                {checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <select
                style={styles.input}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(Number(e.target.value))}
              >
                <option value={0}>Select user</option>
                {users
                  .filter(
                    (u) =>
                      (u.role === "user" || u.id === user.id) &&
                      u.active !== false &&
                      u.approvalStatus !== "pending"
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === user.id ? `${u.name} (Me)` : u.name}
                    </option>
                  ))}
              </select>

              <button style={styles.button} onClick={assign}>
                Assign
              </button>
            </div>
            </div>

            <div className="admin-main-panel">
            <div className="compact-list" aria-label="Assignments list">
              {assignments.length === 0 ? (
                <div style={styles.small}>No assignments yet.</div>
              ) : (
                assignments
                  .slice(getVisibleListStart("assignments"), getVisibleListCount("assignments"))
                  .map((a) => {
                  const rowKey = `assignment-${a.id}`;
                  const isOpen = isExpandedRow(rowKey);

                  return (
                    <div
                      key={a.id}
                      className={`compact-row ${isOpen ? "compact-row-open" : ""}`}
                    >
                      <div className="compact-row-main">
                        <button
                          type="button"
                          className="compact-row-toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} assignment details`}
                      onClick={() => toggleExpandedRow(rowKey)}
                        >
                          {isOpen ? "-" : "+"}
                        </button>
                        <div className="compact-row-title">
                          <strong>{a.checklistTitle}</strong>
                          <span>Assigned to {a.assignedToName}</span>
                        </div>
                      </div>
                      <div className="compact-row-meta">
                        <span>{a.status}</span>
                        <span>{formatDateTime(a.assigned_at)}</span>
                      </div>
                      <div className="compact-row-actions">
                        <span>Assigned by {a.assignedByName}</span>
                      </div>
                    </div>
                  );
                })
              )}
              <ShowMoreButton
                visibleCount={getVisibleListCount("assignments")}
                totalCount={assignments.length}
                onBack={() => goBackListItems("assignments")}
                      onClick={() => showMoreListItems("assignments")}
              />
            </div>
            </div>
            </div>
          </div>
          ) : null}

          {activeAdminPage === "users" ? (
          <div className="admin-page-panel" style={styles.section}>
            <div className="admin-panel-heading">
              <div>
                <h3 style={styles.title}>User Management</h3>
                <p>Create users, approve requests, edit access, and generate password reset links.</p>
              </div>
              {!isPlatformAdmin ? (
                <button
                  type="button"
                  style={styles.button}
                      onClick={() => {
                    setActiveAdminPage("organizations");
                    setMessage("");
                    setError("");
                  }}
                >
                  Create Sub-Organization
                </button>
              ) : null}
            </div>

            {isPlatformAdmin && (
              <div style={{ ...styles.small, marginBottom: 12 }}>
                Users are grouped by organization. Platform admin accounts are hidden from this list.
              </div>
            )}

            {pendingUsers.length > 0 ? (
              <div style={{ ...styles.section, background: "#fff8e6", marginBottom: 14 }}>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Pending Approval</h4>

                {(organizations.length > 0 ? pendingUserGroups : [currentOrganizationUserGroup(pendingUsers)]).map((group) => (
                  <div key={group.key} style={organizations.length > 0 ? styles.section : undefined}>
                    {organizations.length > 0 ? (
                      <div style={{ marginBottom: 10 }}>
                        <strong>{group.name}</strong>
                        {group.organization && !group.organization.active ? (
                          <span style={{ ...styles.small, marginLeft: 8 }}>inactive</span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="compact-list">
                      {group.users
                        .slice(
                          getVisibleListStart(`pending-users-${group.key}`),
                          getVisibleListCount(`pending-users-${group.key}`)
                        )
                        .map((u) => {
                        const rowKey = `pending-user-${u.id}`;
                        const isOpen = isExpandedRow(rowKey);

                        return (
                          <div
                            key={u.id}
                            className={`compact-row compact-row-editable ${isOpen ? "compact-row-open" : ""}`}
                          >
                            <div className="compact-row-main">
                              <button
                                type="button"
                                className="compact-row-toggle"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} pending user actions`}
                      onClick={() => toggleExpandedRow(rowKey)}
                              >
                                {isOpen ? "-" : "+"}
                              </button>
                              <div className="compact-row-title">
                                <strong>{u.name || "Pending user"}</strong>
                                <span>
                                  {u.email || "No email"} | {u.username || "No username yet"}
                                </span>
                              </div>
                            </div>
                            <div className="compact-row-meta">
                              <span>pending</span>
                              <span>Email: {u.email || "No email provided"}</span>
                              {u.organizationName ? <span>{u.organizationName}</span> : null}
                            </div>
                            <div className="compact-row-actions compact-row-form">
                              <input
                                style={styles.input}
                                type="email"
                                placeholder="Email"
                                value={pendingUserForms[u.id]?.email ?? u.email ?? ""}
                                onChange={(e) =>
                                  setPendingUserForms((prev) => ({
                                    ...prev,
                                    [u.id]: {
                                      email: e.target.value,
                                      username: prev[u.id]?.username || u.username,
                                      name: prev[u.id]?.name || u.name,
                                    },
                                  }))
                                }
                              />
                              <input
                                style={styles.input}
                                placeholder="Username"
                                value={pendingUserForms[u.id]?.username || ""}
                                onChange={(e) =>
                                  setPendingUserForms((prev) => ({
                                    ...prev,
                                    [u.id]: {
                                      email: prev[u.id]?.email || u.email || "",
                                      username: e.target.value,
                                      name: prev[u.id]?.name || u.name,
                                    },
                                  }))
                                }
                              />
                              <input
                                style={styles.input}
                                placeholder="Full Name"
                                value={pendingUserForms[u.id]?.name || ""}
                                onChange={(e) =>
                                  setPendingUserForms((prev) => ({
                                    ...prev,
                                    [u.id]: {
                                      email: prev[u.id]?.email || u.email || "",
                                      username: prev[u.id]?.username || u.username,
                                      name: e.target.value,
                                    },
                                  }))
                                }
                              />
                              <button
                                style={styles.button}
                      onClick={() => handleApproveUser(u)}
                              >
                                Approve User
                              </button>
                              <button
                                style={styles.secondaryButton}
                      onClick={() => handleDeleteUser(u.id)}
                              >
                                Reject Request
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <ShowMoreButton
                        visibleCount={getVisibleListCount(`pending-users-${group.key}`)}
                        totalCount={group.users.length}
                        onBack={() => goBackListItems(`pending-users-${group.key}`)}
                      onClick={() => showMoreListItems(`pending-users-${group.key}`)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="admin-two-column users-layout">
            <div className="admin-side-panel" style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
            <h4 style={{ ...styles.title, marginBottom: 10 }}>Create User</h4>
            <div className="admin-form-grid" style={{ ...styles.row, marginBottom: 14 }}>
              {organizations.length > 0 ? (
                <select
                  style={styles.input}
                  value={newUserOrganizationId}
                  onChange={(e) => setNewUserOrganizationId(Number(e.target.value))}
                >
                  <option value={0}>Select organization</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                style={styles.input}
                type="email"
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
              <PasswordInput
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Full Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <select
                style={styles.input}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>

              <button style={styles.button} onClick={handleCreateUser}>
                Create User
              </button>
            </div>
            </div>

            <div className="admin-main-panel">
            {approvedUsers.length === 0 ? (
              <div style={styles.small}>No users found.</div>
            ) : (
              (organizations.length > 0 ? approvedUserGroups : [currentOrganizationUserGroup(approvedUsers)]).map((group) => (
                <div key={group.key} style={organizations.length > 0 ? styles.section : undefined}>
                  {organizations.length > 0 ? (
                    <div style={{ marginBottom: 10 }}>
                      <strong>{group.name}</strong>
                      <div style={styles.small}>
                        {group.users.length} users
                        {group.organization
                          ? ` | ${group.organization.adminCount} admins | ${group.organization.inspectorCount} inspectors`
                          : ""}
                      </div>
                    </div>
                  ) : null}

                  <div className="compact-list">
                  {group.users
                    .slice(
                      getVisibleListStart(`approved-users-${group.key}`),
                      getVisibleListCount(`approved-users-${group.key}`)
                    )
                    .map((u) => {
                    const rowKey = `user-${u.id}`;
                    const isOpen = isExpandedRow(rowKey);

                    return (
                <div
                  key={u.id}
                  className={`compact-row compact-row-editable ${isOpen || editingUserId === u.id ? "compact-row-open" : ""}`}
                >
                  {editingUserId === u.id ? (
                    <>
                      <div style={{ ...styles.row, marginBottom: 10 }}>
                        <input
                          style={styles.input}
                          type="email"
                          placeholder="Email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                        />
                        <input
                          style={styles.input}
                          placeholder="Username"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                        />
                        <PasswordInput
                          placeholder="New Password (optional)"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                        />
                        <input
                          style={styles.input}
                          placeholder="Full Name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <select
                          style={styles.input}
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as "admin" | "user")}
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>
                      <div style={styles.row}>
                        <button style={styles.secondaryButton} onClick={cancelEditUser}>
                          Cancel
                        </button>
                        <button style={styles.button} onClick={handleUpdateUser}>
                          Save Changes
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="compact-row-main">
                        <button
                          type="button"
                          className="compact-row-toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} user actions`}
                      onClick={() => toggleExpandedRow(rowKey)}
                        >
                          {isOpen ? "-" : "+"}
                        </button>
                        <div className="compact-row-title">
                          <strong>{u.name}</strong>
                          <span>
                            {u.email || "No email"} | {u.username} | Password stored securely
                          </span>
                        </div>
                      </div>
                      <div className="compact-row-meta">
                        <span>{u.role}</span>
                        <span>{u.active === false ? "inactive" : "active"}</span>
                      </div>
                      <div className="compact-row-actions">
                        <button
                          style={styles.secondaryButton}
                      onClick={() => startEditUser(u)}
                        >
                          Edit User
                        </button>
                        <button
                          style={styles.secondaryButton}
                      onClick={() => handleCreatePasswordResetLink(u)}
                          disabled={passwordResetLinkLoadingId === u.id}
                        >
                          {passwordResetLinkLoadingId === u.id
                            ? "Creating..."
                            : "Generate Reset Link"}
                        </button>
                        {isPlatformAdmin ? (
                          <button
                            style={styles.secondaryButton}
                            onClick={() => handleCreateTemporaryPassword(u)}
                            disabled={temporaryPasswordLoadingId === u.id}
                          >
                            {temporaryPasswordLoadingId === u.id
                              ? "Creating..."
                              : "Set Temporary Password"}
                          </button>
                        ) : null}
                        <button
                          style={styles.button}
                      onClick={() => handleDeleteUser(u.id)}
                          disabled={u.id === user.id}
                        >
                          Delete User
                        </button>
                        {u.id === user.id ? (
                          <span style={{ fontSize: 12, color: "#5e7378" }}>
                            You cannot delete your own account
                          </span>
                        ) : null}
                      </div>
                      {passwordResetLinks[u.id] ? (
                        <div style={{ marginTop: 10 }}>
                          <input
                            style={styles.input}
                            readOnly
                            value={passwordResetLinks[u.id]}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <div style={styles.small}>
                            Share this link manually. Email delivery is not enabled yet.
                          </div>
                        </div>
                      ) : null}
                      {temporaryPasswords[u.id] ? (
                        <div style={{ marginTop: 10 }}>
                          <input
                            style={styles.input}
                            readOnly
                            value={temporaryPasswords[u.id]}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <div style={styles.small}>
                            This is the user's new password. It is shown here once and is not stored in readable form.
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                    );
                  })}
                  <ShowMoreButton
                    visibleCount={getVisibleListCount(`approved-users-${group.key}`)}
                    totalCount={group.users.length}
                    onBack={() => goBackListItems(`approved-users-${group.key}`)}
                      onClick={() => showMoreListItems(`approved-users-${group.key}`)}
                  />
                  </div>
                </div>
              ))
            )}
            </div>
            </div>
          </div>
          ) : null}

          {activeAdminPage === "walkthroughs" ? (
            <div style={styles.section}>
              <h3 style={styles.title}>Walkthrough</h3>
              <div style={styles.small}>
                Prepare an on-the-go inspection list for your organization. Save as a draft or
                complete it as a walkthrough report.
              </div>

              <div className="walkthrough-builder" style={{ ...styles.section, background: "#fff" }}>
                <div className="walkthrough-meta-row">
                  <input
                    style={styles.input}
                    placeholder="Walkthrough title"
                    value={walkthroughTitle}
                    onChange={(e) => setWalkthroughTitle(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Location / area"
                    value={walkthroughLocation}
                    onChange={(e) => setWalkthroughLocation(e.target.value)}
                  />
                </div>

                {walkthroughSections.map((section, sectionIndex) => (
                  <div
                    key={sectionIndex}
                    className="walkthrough-section-card"
                    style={{ ...styles.section, background: "#fbfefd" }}
                  >
                    <input
                      style={{ ...styles.input, marginBottom: 10 }}
                      placeholder={`Section ${sectionIndex + 1}`}
                      value={section.title}
                      onChange={(e) => updateWalkthroughSectionTitle(sectionIndex, e.target.value)}
                    />

                    {section.items.map((item, itemIndex) => {
                      const uploadKey = `${sectionIndex}-${itemIndex}`;

                      return (
                        <div
                          key={itemIndex}
                          className="walkthrough-comment-card"
                          style={{ ...styles.section, background: "#fff" }}
                        >
                          <div className="walkthrough-comment-layout">
                            <div>
                              <label className="walkthrough-field-label">
                                Observation / Comment
                              </label>
                              <textarea
                                className="walkthrough-comment-field"
                                style={styles.input}
                                placeholder="Write observation, negative finding, or comment here"
                                value={item.comment}
                                onChange={(e) =>
                                  updateWalkthroughItem(sectionIndex, itemIndex, {
                                    comment: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="walkthrough-field-label">Severity</label>
                              <select
                                style={styles.input}
                                value={item.severity || ""}
                                onChange={(e) =>
                                  updateWalkthroughItem(sectionIndex, itemIndex, {
                                    severity: e.target.value,
                                  })
                                }
                              >
                                <option value="">Severity</option>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                                <option value="Critical">Critical</option>
                              </select>
                            </div>
                          </div>

                          <div
                            style={{ marginTop: 12 }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleWalkthroughPhotos(sectionIndex, itemIndex, e.dataTransfer.files);
                            }}
                          >
                            <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
                              Add Photos
                            </label>
                            <label className="file-upload-button">
                              <span>Choose File</span>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => {
                                  handleWalkthroughPhotos(sectionIndex, itemIndex, e.target.files);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            {walkthroughUploadingKey === uploadKey ? (
                              <div style={{ marginTop: 8, color: "#0f766e", fontSize: 13 }}>
                                Uploading photos...
                              </div>
                            ) : null}
                          </div>

                          {(item.photos || []).length > 0 ? (
                            <div style={styles.photoGrid}>
                              {(item.photos || []).map((photo, photoIndex) => {
                                const src = resolveFileUrl(photo);

                                return (
                                  <div key={photoIndex} style={styles.photoCard}>
                                    <img
                                      src={src}
                                      alt={`walkthrough-${sectionIndex}-${itemIndex}-${photoIndex}`}
                                      style={styles.photoPreview}
                                    />
                                    <button
                                      type="button"
                                      style={styles.removeButton}
                      onClick={() =>
                                        removeWalkthroughPhoto(sectionIndex, itemIndex, photoIndex)
                                      }
                                    >
                                      Remove
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          <div
                            className="walkthrough-comment-actions"
                            style={{ ...styles.row, marginTop: 10 }}
                          >
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => addWalkthroughItem(sectionIndex)}
                            >
                              Add Comment After This
                            </button>
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => removeWalkthroughItem(sectionIndex, itemIndex)}
                            >
                              Remove Comment
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                <div className="walkthrough-form-actions" style={{ ...styles.row, marginTop: 12 }}>
                  <button type="button" style={styles.secondaryButton} onClick={addWalkthroughSection}>
                    Add Section
                  </button>
                  <button type="button" style={styles.secondaryButton} onClick={resetWalkthroughForm}>
                    Clear
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                      onClick={() => saveWalkthrough("draft")}
                  >
                    Save Draft
                  </button>
                  <button type="button" style={styles.button} onClick={() => saveWalkthrough("completed")}>
                    Complete Walkthrough
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <h3 style={styles.title}>Walkthrough List</h3>
                {walkthroughs.length === 0 ? (
                  <div style={styles.small}>No walkthroughs yet.</div>
                ) : (
                  <>
                    {walkthroughs
                      .slice(getVisibleListStart("walkthroughs"), getVisibleListCount("walkthroughs"))
                      .map((walkthrough) => (
                    <div key={walkthrough.id} style={styles.section}>
                      <strong>{walkthrough.title}</strong>
                      {walkthrough.location ? <> - {walkthrough.location}</> : null}
                      <br />
                      Status: {walkthrough.status}
                      <br />
                      Created By: {walkthrough.createdByName || "-"}
                      <br />
                      Sections: {walkthrough.sections.length}
                      <br />
                      Comments:{" "}
                      {walkthrough.sections.reduce(
                        (total, section) => total + section.items.length,
                        0
                      )}
                      <div style={{ ...styles.row, marginTop: 10 }}>
                        {walkthrough.status === "draft" ? (
                          <button
                            type="button"
                            style={styles.secondaryButton}
                      onClick={() => editWalkthrough(walkthrough)}
                          >
                            Continue Draft
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => setSelectedWalkthrough(walkthrough)}
                            >
                              View Walkthrough Report
                            </button>
                            <button
                              type="button"
                              style={styles.button}
                      onClick={() => handleEmailWalkthrough(walkthrough)}
                            >
                              Email Report
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          style={styles.secondaryButton}
                      onClick={() => handleDeleteWalkthrough(walkthrough.id)}
                        >
                          Delete Walkthrough
                        </button>
                      </div>
                    </div>
                  ))}
                    <ShowMoreButton
                      visibleCount={getVisibleListCount("walkthroughs")}
                      totalCount={walkthroughs.length}
                      onBack={() => goBackListItems("walkthroughs")}
                      onClick={() => showMoreListItems("walkthroughs")}
                    />
                  </>
                )}
              </div>
            </div>
          ) : null}

          {activeAdminPage === "reports" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Completed Reports</h3>

            <div style={{ ...styles.section, background: "#fff" }}>
              <h3 style={styles.title}>Walkthrough Reports</h3>
              {completedWalkthroughs.length === 0 ? (
                <div style={styles.small}>No completed walkthrough reports yet.</div>
              ) : (
                <div className="compact-list">
                  {completedWalkthroughs
                    .slice(
                      getVisibleListStart("walkthrough-reports"),
                      getVisibleListCount("walkthrough-reports")
                    )
                    .map((walkthrough) => {
                      const rowKey = `walkthrough-report-${walkthrough.id}`;
                      const isOpen = isExpandedRow(rowKey);
                      const commentCount = walkthrough.sections.reduce(
                        (total, section) => total + section.items.length,
                        0
                      );

                      return (
                        <div
                          key={walkthrough.id}
                          className={`compact-row ${isOpen ? "compact-row-open" : ""}`}
                        >
                          <div className="compact-row-main">
                            <button
                              type="button"
                              className="compact-row-toggle"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} walkthrough report actions`}
                      onClick={() => toggleExpandedRow(rowKey)}
                            >
                              {isOpen ? "-" : "+"}
                            </button>
                            <div className="compact-row-title">
                              <strong>{walkthrough.title}</strong>
                              <span>{walkthrough.location || walkthrough.organizationName || "Walkthrough report"}</span>
                            </div>
                          </div>
                          <div className="compact-row-meta">
                            <span>{walkthrough.sections.length} sections</span>
                            <span>{commentCount} comments</span>
                          </div>
                          <div className="compact-row-actions">
                            <span>Created by {walkthrough.createdByName || "-"}</span>
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => setSelectedWalkthrough(walkthrough)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              style={styles.button}
                      onClick={() => handleEmailWalkthrough(walkthrough)}
                            >
                              Email
                            </button>
                            <button
                              type="button"
                              style={styles.secondaryButton}
                      onClick={() => handleDeleteWalkthrough(walkthrough.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  <ShowMoreButton
                    visibleCount={getVisibleListCount("walkthrough-reports")}
                    totalCount={completedWalkthroughs.length}
                    onBack={() => goBackListItems("walkthrough-reports")}
                      onClick={() => showMoreListItems("walkthrough-reports")}
                  />
                </div>
              )}
            </div>

            {reports.length === 0 ? (
              <div style={styles.small}>No reports yet.</div>
            ) : (
              <div className="compact-list">
                {reports
                  .slice(getVisibleListStart("reports"), getVisibleListCount("reports"))
                  .map((r) => {
                  const rowKey = `report-${r.id}`;
                  const isOpen = isExpandedRow(rowKey);

                  return (
                    <div
                      key={r.id}
                      className={`compact-row ${isOpen ? "compact-row-open" : ""}`}
                    >
                      <div className="compact-row-main">
                        <button
                          type="button"
                          className="compact-row-toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} report actions`}
                      onClick={() => toggleExpandedRow(rowKey)}
                        >
                          {isOpen ? "-" : "+"}
                        </button>
                        <div className="compact-row-title">
                          <strong>{r.checklistTitle}</strong>
                          <span>Completed by {r.completedByName}</span>
                        </div>
                      </div>
                      <div className="compact-row-meta">
                        <span>{r.status}</span>
                        <span>{formatDateTime(r.completed_at)}</span>
                      </div>
                      <div className="compact-row-actions">
                        <span>Assigned to {r.assignedToName}</span>
                        <button
                          style={styles.secondaryButton}
                      onClick={() => setSelectedReport(r)}
                        >
                          View
                        </button>

                        <button
                          style={styles.button}
                      onClick={() => handleDownloadPdf(r)}
                        >
                          PDF
                        </button>
                        <button
                          style={styles.secondaryButton}
                      onClick={() => handleEmailReport(r)}
                        >
                          Email
                        </button>

                        <a
                          style={{ ...styles.button, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                          href={getActionPlanExcelDownloadUrl(r.id)}
                        >
                          Action Plan
                        </a>

                        <button
                          style={styles.button}
                      onClick={() => handleDownloadManagerSummary(r)}
                          disabled={managerSummaryReportId === r.id}
                        >
                          {managerSummaryReportId === r.id ? "Preparing..." : "Summary"}
                        </button>

                        <button
                          style={styles.button}
                      onClick={() => handleDeleteReport(r.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                <ShowMoreButton
                  visibleCount={getVisibleListCount("reports")}
                  totalCount={reports.length}
                  onBack={() => goBackListItems("reports")}
                      onClick={() => showMoreListItems("reports")}
                />
              </div>
            )}
          </div>
          ) : null}
          </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
