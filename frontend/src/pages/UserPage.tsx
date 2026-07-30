import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AnswerType,
  ActionPlanItem,
  ActionPlanStatus,
  AppMessage,
  Assignment,
  Checklist,
  ManagerSummaryResponse,
  Report,
  User,
  Walkthrough,
  WalkthroughSection,
} from "../types";
import { styles } from "../styles/appStyles";
import DashboardShell from "../components/DashboardShell";
import ManagerSummaryPanel from "../components/ManagerSummaryPanel";
import PasswordInput from "../components/PasswordInput";
import ReportDetail from "../components/ReportDetail";
import ReportEmailDialog from "../components/ReportEmailDialog";
import WalkthroughDetail from "../components/WalkthroughDetail";
import SlowDataLoadDialog from "../components/SlowDataLoadDialog";
import { getAssignments, startTemplate } from "../services/assignmentService";
import {
  getChecklists,
  getCommunityTemplates,
  importCommunityTemplate,
  shareChecklistWithCommunity,
} from "../services/checklistService";
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
import { deleteReport, getReports } from "../services/reportService";
import {
  createWalkthrough,
  deleteWalkthrough,
  getWalkthroughs,
  updateWalkthrough,
} from "../services/walkthroughService";
import {
  createSupportTicket,
  emailReport,
  getReportEmailRecipients,
  ReportEmailRecipient,
} from "../services/emailService";
import { updateUser } from "../services/userService";
import {
  generateManagerSummary,
  getActionPlanExcelDownloadUrl,
  getReportFailedItems,
  getReportManagerSummaryItems,
} from "../services/aiActionPlanService";
import { generateChecklistPdf } from "../utils/generateChecklistPdf";
import {
  createDownloadFromUrl,
  GeneratedDownload,
  openDownload,
  revokeDownload,
} from "../utils/downloadFile";
import { getMessages, markMessageRead } from "../services/messageService";
import { getActionPlans, updateActionPlan } from "../services/actionPlanService";

const AUTO_LOGOFF_SAVE_EVENT = "inspectria:auto-logoff-save";
const LIST_PAGE_SIZE = 10;
const ACTION_PLAN_STATUSES: ActionPlanStatus[] = ["Open", "In Progress", "Blocked", "Done"];

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

type VisibleChecklistItem = Checklist["sections"][number]["items"][number] & {
  id: number;
  parentItemId?: number;
};

type VisibleChecklistSection = {
  id: string;
  title: string;
  items: VisibleChecklistItem[];
};

type Props = {
  user: User;
  onLogout: () => Promise<void>;
};

type UserSectionKey =
  | "dashboard"
  | "availableTemplates"
  | "assignments"
  | "actionPlans"
  | "communityTemplates"
  | "messages"
  | "walkthroughs"
  | "reports"
  | "account"
  | "support";

type ReportEmailTarget =
  | { type: "checklist"; report: Report }
  | { type: "walkthrough"; walkthrough: Walkthrough };

type RoleGuide = {
  key: "user" | "admin" | "topLevel";
  title: string;
  description: string;
  items: string[];
};

const USER_SECTIONS: Array<{
  key: UserSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Your work summary",
  },
  {
    key: "availableTemplates",
    label: "Available Templates",
    description: "Start templates available to you",
  },
  {
    key: "assignments",
    label: "My Assignments",
    description: "Open assigned checklist work",
  },
  {
    key: "actionPlans",
    label: "Action Plan",
    description: "Update your assigned action items",
  },
  {
    key: "communityTemplates",
    label: "Community Templates",
    description: "Use shared community templates",
  },
  {
    key: "messages",
    label: "Messages",
    description: "Read organization messages",
  },
  {
    key: "walkthroughs",
    label: "Walkthrough",
    description: "Create and manage walkthroughs",
  },
  {
    key: "reports",
    label: "My Reports",
    description: "Review completed reports",
  },
  {
    key: "account",
    label: "My Account",
    description: "Update your password",
  },
  {
    key: "support",
    label: "Support",
    description: "Send an issue to support",
  },
];

const ROLE_GUIDES: RoleGuide[] = [
  {
    key: "user",
    title: "User",
    description: "Complete day-to-day control and on-site inspection work.",
    items: [
      "Open and complete checklists assigned to you, including answers, notes, and photos.",
      "View organization reports available to you and export them as PDF or Excel files.",
      "Select and use templates shared with you by your administrator.",
      "Create walkthrough lists for on-site checks, save drafts, and complete them later.",
      "Follow announcements and shared templates from your organization in Messages.",
    ],
  },
  {
    key: "admin",
    title: "Organization Admin",
    description: "Manage control processes and users in your organization.",
    items: [
      "Create, edit, and share checklist templates in Templates.",
      "Assign control tasks by choosing a template and a user in Assignments.",
      "Create, edit, approve, and assign roles to users in User Management.",
      "Review completed reports, export PDF or Excel files, and create action plans.",
      "Manage flexible on-site inspection lists in Walkthrough.",
    ],
  },
  {
    key: "topLevel",
    title: "Top Level Admin (Enterprise)",
    description: "An Enterprise top-level administrator can manage connected units separately.",
    items: [
      "Create a new sub-organization from Sub Organizations with Create Sub-Organization.",
      "Enter administrator details in the form to create the first admin for that sub-organization in the same flow.",
      "Choose the relevant organization in User Management to create new users and assign admin access when needed.",
      "Assign templates you create to the correct users and organizations through Assignments.",
      "Track reports and users for each sub-organization within their own access boundaries.",
    ],
  },
];

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
    showSuccessRate: false,
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

function getConditionalItemId(parentItemId: number, conditionalIndex: number) {
  return -(parentItemId * 1000 + conditionalIndex + 1);
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

function getReportScore(report: Report) {
  const scoredItems = (report.items || []).filter((item) => {
    const answer = String(item.answer || "").trim().toUpperCase();
    return answer === "YES" || answer === "NO";
  });
  const yesCount = scoredItems.filter(
    (item) => String(item.answer || "").trim().toUpperCase() === "YES"
  ).length;

  return {
    yesCount,
    scoredCount: scoredItems.length,
    percent: scoredItems.length > 0 ? Math.round((yesCount / scoredItems.length) * 100) : null,
  };
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

export default function UserPage({ user, onLogout }: Props) {
  const localDraftKey = `mod_draft_${user.id}`;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlanItem[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [communityTemplates, setCommunityTemplates] = useState<Checklist[]>([]);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [activeUserPage, setActiveUserPage] = useState<UserSectionKey>("dashboard");
  const [reports, setReports] = useState<Report[]>([]);
  const [reportEmailRecipients, setReportEmailRecipients] = useState<ReportEmailRecipient[]>([]);
  const [reportEmailTarget, setReportEmailTarget] = useState<ReportEmailTarget | null>(null);
  const [reportEmailSending, setReportEmailSending] = useState(false);
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [activeAssignmentId, setActiveAssignmentId] = useState<number | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<Walkthrough | null>(null);
  const [showSlowDataLoadDialog, setShowSlowDataLoadDialog] = useState(false);
  const [form, setForm] = useState<Record<number, FillItem>>({});
  const [message, setMessage] = useState("");
  const [managerSummaryReportId, setManagerSummaryReportId] = useState<number | null>(null);
  const [generatedDownload, setGeneratedDownload] = useState<GeneratedDownload | null>(null);
  const [managerSummaryPreview, setManagerSummaryPreview] = useState<{
    report: Report;
    summary: ManagerSummaryResponse;
  } | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState("");
  const [walkthroughTitle, setWalkthroughTitle] = useState("");
  const [walkthroughLocation, setWalkthroughLocation] = useState("");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportStatus, setSupportStatus] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [walkthroughSections, setWalkthroughSections] = useState<WalkthroughSection[]>([
    { title: "General", items: [{ comment: "", severity: "", photos: [] }] },
  ]);
  const [editingWalkthroughId, setEditingWalkthroughId] = useState<number | null>(null);
  const [walkthroughUploadingKey, setWalkthroughUploadingKey] = useState<string | null>(null);
  const [visibleListCounts, setVisibleListCounts] = useState<Record<string, number>>({});
  const activeAssignmentIdRef = useRef<number | null>(null);
  const latestFormRef = useRef<Record<number, FillItem>>({});
  const saveTimeoutRef = useRef<number | null>(null);
  const slowDataLoadTimerRef = useRef<number | null>(null);
  const questionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [resumeItemId, setResumeItemId] = useState<number | null>(null);
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

  const load = async () => {
    if (slowDataLoadTimerRef.current) {
      window.clearTimeout(slowDataLoadTimerRef.current);
    }

    slowDataLoadTimerRef.current = window.setTimeout(() => {
      setShowSlowDataLoadDialog(true);
    }, 3000);

    try {
      const [a, actionPlanRows, c, community, r, w, inbox, emailRecipients] = await Promise.all([
        getAssignments(),
        getActionPlans(),
        getChecklists(),
        getCommunityTemplates(),
        getReports(),
        getWalkthroughs(),
        getMessages(),
        getReportEmailRecipients().catch(() => []),
      ]);
      setAssignments(a);
      setActionPlans(actionPlanRows);
      setChecklists(c);
      setCommunityTemplates(community);
      setMessages(inbox.messages);
      setReports(r);
      setReportEmailRecipients(emailRecipients);
      setWalkthroughs(w);
    } finally {
      if (slowDataLoadTimerRef.current) {
        window.clearTimeout(slowDataLoadTimerRef.current);
        slowDataLoadTimerRef.current = null;
      }
      setShowSlowDataLoadDialog(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveActionPlanProgress = async (
    plan: ActionPlanItem,
    remarks: string,
    status: ActionPlanStatus
  ) => {
    try {
      await updateActionPlan(plan.id, { remarks, status });
      setActionPlans(await getActionPlans());
      setMessage("Action Plan item updated.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action Plan item could not be updated");
    }
  };

  useEffect(() => {
    return () => {
      if (slowDataLoadTimerRef.current) {
        window.clearTimeout(slowDataLoadTimerRef.current);
      }
    };
  }, []);

  const activeAssignment =
    assignments.find((a) => a.id === activeAssignmentId) || null;

  useEffect(() => {
    activeAssignmentIdRef.current = activeAssignmentId;
  }, [activeAssignmentId]);

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  const activeChecklist = useMemo(() => {
    if (!activeAssignment) return null;
    return checklists.find((c) => c.id === activeAssignment.checklist_id) || null;
  }, [activeAssignment, checklists]);

  const visibleChecklistSections = useMemo<VisibleChecklistSection[]>(() => {
    if (!activeChecklist) return [];

    return activeChecklist.sections.map((section) => ({
      id: `section-${section.id}`,
      title: section.title,
      items: section.items.flatMap((item) => {
        const visibleItems: VisibleChecklistItem[] = [item as VisibleChecklistItem];
        const conditionalItems = item.conditionalItems || [];

        if ((form[item.id]?.answer || "") === "YES" && conditionalItems.length > 0) {
          visibleItems.push(
            ...conditionalItems.map((conditionalItem, index) => ({
              ...conditionalItem,
              id: getConditionalItemId(item.id, index),
              checklist_id: item.checklist_id,
              section_id: item.section_id,
              sort_order: index + 1,
              parentItemId: item.id,
            }))
          );
        }

        return visibleItems;
      }),
    }));
  }, [activeChecklist, form]);

  const activeSection = visibleChecklistSections[activeSectionIndex] || null;
  const sectionCount = visibleChecklistSections.length;

  const checklistProgress = useMemo(() => {
    const items = visibleChecklistSections.flatMap((section) => section.items);
    const total = items.length;
    const answered = items.filter((item) => (form[item.id]?.answer || "").trim()).length;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

    return { answered, total, percent };
  }, [visibleChecklistSections, form]);

  const activeSectionProgress = useMemo(() => {
    const items = visibleChecklistSections[activeSectionIndex]?.items || [];
    const total = items.length;
    const answered = items.filter((item) => (form[item.id]?.answer || "").trim()).length;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

    return { answered, total, percent };
  }, [visibleChecklistSections, activeSectionIndex, form]);

  useEffect(() => {
    if (!activeChecklist) {
      setActiveSectionIndex(0);
      return;
    }

    setActiveSectionIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(sectionCount - 1, 0))
    );
  }, [activeChecklist, sectionCount]);

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
      saveDraft(assignmentId, nextForm).catch((error) => {
        console.error(error);
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

  const openAssignment = async (assignment: Assignment) => {
    const checklist = checklists.find((c) => c.id === assignment.checklist_id);
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
        Object.entries(newestDraft.form).forEach(([itemId, draftItem]) => {
          const numericItemId = Number(itemId);
          if (numericItemId < 0) {
            merged[numericItemId] = draftItem;
          }
        });

        setMessage("Saved draft loaded. You can continue from where you left off.");
      } else {
        setMessage("");
      }
    } catch (error) {
      console.error(error);

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
        Object.entries(localDraft.form).forEach(([itemId, draftItem]) => {
          const numericItemId = Number(itemId);
          if (numericItemId < 0) {
            merged[numericItemId] = draftItem;
          }
        });
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
    } catch (error) {
      alert(error instanceof Error ? error.message : "Template could not be opened.");
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
    } catch (error) {
      console.error(error);
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
          photos: prev[itemId].photos.filter((_, idx) => idx !== photoIndex),
        },
      };

      if (activeAssignmentIdRef.current) {
        persistDraft(activeAssignmentIdRef.current, nextForm);
      }

      return nextForm;
    });
  };

  const handleShareTemplateWithCommunity = async (checklist: Checklist) => {
    setMessage("");
    if (!window.confirm(`Share ${checklist.title} with the Inspectria community?`)) return;

    try {
      await shareChecklistWithCommunity(checklist.id);
      setMessage(`${checklist.title} shared with Community Templates.`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Template could not be shared with community.");
    }
  };

  const openCommunityTemplate = async (checklist: Checklist) => {
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
      alert(err instanceof Error ? err.message : "Community template could not be opened.");
    } finally {
      setStartingTemplateId(null);
    }
  };

  const updateAnswer = (itemId: number, answer: string) => {
    setForm((prev) => {
      const item = activeChecklist?.sections
        .flatMap((section) => section.items)
        .find((candidate) => candidate.id === itemId);
      const conditionalItemIds =
        item && answer !== "YES"
          ? (item.conditionalItems || []).map((_, index) =>
              getConditionalItemId(item.id, index)
            )
          : [];
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          answer,
          touchedAt: new Date().toISOString(),
        },
      };
      conditionalItemIds.forEach((conditionalItemId) => {
        delete nextForm[conditionalItemId];
      });

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

  const submit = async () => {
    if (!activeChecklist || !activeAssignment) return;

    const items = visibleChecklistSections.flatMap((section) =>
      section.items.map((item) => ({
        ...form[item.id],
        itemId: item.parentItemId || item.id,
        question: item.question,
        sectionTitle: section.title,
        answerType: item.answerType || item.answer_type || "FORMAT1",
        options: item.options || [],
        photos: form[item.id]?.photos || [],
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

  const saveAndContinueLater = () => {
    if (!activeAssignment) return;

    persistDraft(activeAssignment.id, latestFormRef.current, {
      immediateRemote: true,
    });
    setActiveAssignmentId(null);
    setActiveSectionIndex(0);
    setMessage("Checklist draft saved. You can continue later.");
  };

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

  const handleDownloadPdf = async (report: Report) => {
    const pdfPayload = mapReportToPdfPayload(report);
    await generateChecklistPdf(pdfPayload as any);
  };

  const handleDownloadManagerSummary = async (report: Report) => {
    const summaryItems = getReportManagerSummaryItems(report);

    if (summaryItems.length === 0) {
      alert("This report has no negative YES/NO items or comments to summarize.");
      return;
    }

    try {
      setManagerSummaryReportId(report.id);
      setMessage("Preparing manager summary...");
      const result = await generateManagerSummary(report);
      setManagerSummaryPreview({ report, summary: result });
      setMessage(
        result.provider === "azure-openai" || result.provider === "openai"
          ? "Manager summary is ready. Use Print / Save as PDF to export it."
          : "Manager summary is ready with local fallback text. Use Print / Save as PDF to export it."
      );
    } catch (err) {
      setMessage("");
      alert(err instanceof Error ? err.message : "Manager summary could not be generated.");
    } finally {
      setManagerSummaryReportId(null);
    }
  };

  const handleEmailReport = (report: Report) => {
    setReportEmailTarget({ type: "checklist", report });
  };

  const sendChecklistReportEmail = async (report: Report, emails: string[]) => {
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
      alert(err instanceof Error ? err.message : "Report email could not be sent.");
    } finally {
      setReportEmailSending(false);
    }
  };

  const handleEmailWalkthrough = (walkthrough: Walkthrough) => {
    setReportEmailTarget({ type: "walkthrough", walkthrough });
  };

  const sendWalkthroughReportEmail = async (walkthrough: Walkthrough, emails: string[]) => {
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
      alert(err instanceof Error ? err.message : "Walkthrough email could not be sent.");
    } finally {
      setReportEmailSending(false);
    }
  };

  const handleDeleteReport = async (report: Report) => {
    if (!window.confirm("Delete this checklist report?")) return;

    try {
      await deleteReport(report.id);
      setSelectedReport(null);
      setMessage("Checklist report deleted.");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Checklist report could not be deleted.");
    }
  };

  const handleDeleteWalkthrough = async (walkthrough: Walkthrough) => {
    if (!window.confirm("Delete this walkthrough report?")) return;

    try {
      await deleteWalkthrough(walkthrough.id);
      setSelectedWalkthrough(null);
      setMessage("Walkthrough report deleted.");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Walkthrough report could not be deleted.");
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
    } catch (error) {
      console.error(error);
      alert("Photo upload failed.");
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
    const payload = normalizeWalkthroughPayload(status);

    if (!payload.title) {
      alert("Walkthrough title is required.");
      return;
    }

    if (payload.sections.length === 0) {
      alert("Add at least one section with a comment or photo.");
      return;
    }

    if (editingWalkthroughId) {
      await updateWalkthrough(editingWalkthroughId, payload);
      setMessage(status === "completed" ? "Walkthrough completed." : "Walkthrough draft updated.");
    } else {
      await createWalkthrough(payload);
      setMessage(status === "completed" ? "Walkthrough completed." : "Walkthrough draft saved.");
    }

    resetWalkthroughForm();
    await load();
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
    setMessage("Walkthrough draft loaded.");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const isFirstSection = activeSectionIndex === 0;
  const isLastSection = activeSectionIndex >= sectionCount - 1;
  const activeAssignments = assignments.filter((assignment) => assignment.status === "assigned");
  const adminAssignedAssignments = activeAssignments.filter(
    (assignment) => !assignment.isSelfStarted
  );
  const unreadMessageCount = messages.filter((candidate) => !candidate.readAt).length;
  const selfStartedChecklistIds = new Set(
    activeAssignments
      .filter((assignment) => assignment.isSelfStarted)
      .map((assignment) => assignment.checklist_id)
  );
  const draftTemplateCount = activeAssignments.filter(
    (assignment) => assignment.isSelfStarted
  ).length;
  const completedWalkthroughCount = walkthroughs.filter(
    (walkthrough) => walkthrough.status === "completed"
  ).length;
  const draftWalkthroughCount = walkthroughs.filter(
    (walkthrough) => walkthrough.status === "draft"
  ).length;
  const dashboardScore = reports.reduce(
    (total, report) => {
      const score = getReportScore(report);
      return {
        yesCount: total.yesCount + score.yesCount,
        scoredCount: total.scoredCount + score.scoredCount,
      };
    },
    { yesCount: 0, scoredCount: 0 }
  );
  const totalSuccessRate =
    dashboardScore.scoredCount > 0
      ? Math.round((dashboardScore.yesCount / dashboardScore.scoredCount) * 100)
      : null;
  const latestReports = [...reports]
    .sort(
      (left, right) =>
        new Date(right.completed_at || 0).getTime() -
        new Date(left.completed_at || 0).getTime()
    )
    .slice(0, 3);

  const goToSection = (nextIndex: number) => {
    setActiveSectionIndex(Math.max(0, Math.min(nextIndex, sectionCount - 1)));
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const handleMarkMessageRead = async (messageId: number) => {
    try {
      await markMessageRead(messageId);
      const inbox = await getMessages();
      setMessages(inbox.messages);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Message could not be updated.");
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!accountPassword.trim()) {
      alert("New password is required.");
      return;
    }

    if (accountPassword !== accountPasswordConfirm) {
      alert("Password confirmation does not match.");
      return;
    }

    try {
      await updateUser(user.id, { password: accountPassword });
      setAccountPassword("");
      setAccountPasswordConfirm("");
      setMessage("Password changed successfully.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Password could not be changed.");
    }
  };

  const submitSupportTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSupportStatus("");

    try {
      setSupportSending(true);
      await createSupportTicket({ subject: supportSubject, message: supportMessage });
      setSupportSubject("");
      setSupportMessage("");
      setSupportStatus(
        "Your ticket has been sent to the Inspectria Support team. We will get back to you as soon as possible."
      );
    } catch (err) {
      setSupportStatus(
        err instanceof Error ? err.message : "Your ticket could not be sent. Please try again."
      );
    } finally {
      setSupportSending(false);
    }
  };

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <SlowDataLoadDialog open={showSlowDataLoadDialog} />
      {reportEmailTarget ? (
        <ReportEmailDialog
          title={
            reportEmailTarget.type === "checklist"
              ? reportEmailTarget.report.checklistTitle
              : reportEmailTarget.walkthrough.title
          }
          recipients={reportEmailRecipients}
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

      {message ? (
        <div style={{ ...styles.section, background: "#e6f7f5" }}>
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

      {managerSummaryPreview ? (
        <ManagerSummaryPanel
          report={managerSummaryPreview.report}
          summary={managerSummaryPreview.summary}
          onClose={() => setManagerSummaryPreview(null)}
        />
      ) : null}

      {selectedWalkthrough ? (
        <WalkthroughDetail
          walkthrough={selectedWalkthrough}
          onBack={() => setSelectedWalkthrough(null)}
          onEmailReport={handleEmailWalkthrough}
          onDeleteReport={handleDeleteWalkthrough}
        />
      ) : selectedReport ? (
        <ReportDetail
          report={selectedReport}
          onBack={() => setSelectedReport(null)}
          onDownloadPdf={handleDownloadPdf}
          onEmailReport={handleEmailReport}
          onDeleteReport={handleDeleteReport}
          onDownloadActionPlan={(report) => {
            window.location.href = getActionPlanExcelDownloadUrl(report.id);
          }}
          onDownloadManagerSummary={handleDownloadManagerSummary}
          managerSummaryLoading={managerSummaryReportId === selectedReport.id}
        />
      ) : !activeAssignment || !activeChecklist ? (
        <div className="user-page-layout">
          <div className="user-mobile-menu" style={styles.section}>
            <label style={styles.label} htmlFor="user-section-select">
              Menu
            </label>
            <select
              id="user-section-select"
              style={styles.input}
              value={activeUserPage}
              onChange={(event) => setActiveUserPage(event.target.value as UserSectionKey)}
            >
              {USER_SECTIONS.map((section) => (
                <option key={section.key} value={section.key}>
                  {section.label}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-workspace user-workspace">
            <nav className="admin-module-nav user-desktop-nav" aria-label="User menu">
              <div className="admin-module-nav-grid">
                {USER_SECTIONS.map((section) => {
                  const isActive = activeUserPage === section.key;
                  const badgeCount =
                    section.key === "assignments"
                      ? adminAssignedAssignments.length
                      : section.key === "messages"
                        ? unreadMessageCount
                        : 0;

                  return (
                    <button
                      key={section.key}
                      type="button"
                      className={`admin-module-nav-item${isActive ? " admin-module-nav-item-active" : ""}`}
                      onClick={() => setActiveUserPage(section.key)}
                    >
                      <div className="admin-module-nav-label">
                        <span>{section.label}</span>
                        {badgeCount > 0 ? (
                          <span className="admin-module-nav-badge">{badgeCount}</span>
                        ) : null}
                      </div>
                      <div className="admin-module-nav-description">
                        {section.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </nav>

            <div className="admin-workspace-main">
          {activeUserPage === "dashboard" ? (
          <div className="user-dashboard">
            <div className="user-dashboard-hero">
              <div>
                <span>Today</span>
                <h3>{user.name || user.username}</h3>
                <p>
                  {adminAssignedAssignments.length > 0
                    ? `${adminAssignedAssignments.length} assignment waiting for you.`
                    : draftTemplateCount > 0
                      ? "You have template drafts ready to continue."
                      : "No assigned work is waiting right now."}
                </p>
              </div>
              <button
                type="button"
                style={styles.button}
                onClick={() =>
                  setActiveUserPage(
                    adminAssignedAssignments.length > 0 ? "assignments" : "availableTemplates"
                  )
                }
              >
                {adminAssignedAssignments.length > 0 ? "Open Assignments" : "Start Template"}
              </button>
            </div>

            <div className="user-dashboard-metrics">
              <button type="button" onClick={() => setActiveUserPage("reports")}>
                <span>Completed Templates</span>
                <strong>{reports.length}</strong>
              </button>
              <button type="button" onClick={() => setActiveUserPage("reports")}>
                <span>Total Success Rate</span>
                <strong>{totalSuccessRate === null ? "-" : `${totalSuccessRate}%`}</strong>
              </button>
              <button type="button" onClick={() => setActiveUserPage("assignments")}>
                <span>Waiting Assignments</span>
                <strong>{adminAssignedAssignments.length}</strong>
              </button>
              <button type="button" onClick={() => setActiveUserPage("walkthroughs")}>
                <span>Walkthroughs</span>
                <strong>{completedWalkthroughCount}</strong>
              </button>
            </div>

            <div className="user-dashboard-lower">
              <div className="user-dashboard-panel">
                <div className="user-dashboard-panel-title">
                  <strong>Work Queue</strong>
                  <span>{activeAssignments.length} open</span>
                </div>
                <div className="user-dashboard-queue">
                  <button type="button" onClick={() => setActiveUserPage("assignments")}>
                    <span>Assigned by admin</span>
                    <strong>{adminAssignedAssignments.length}</strong>
                  </button>
                  <button type="button" onClick={() => setActiveUserPage("availableTemplates")}>
                    <span>Template drafts</span>
                    <strong>{draftTemplateCount}</strong>
                  </button>
                  <button type="button" onClick={() => setActiveUserPage("walkthroughs")}>
                    <span>Walkthrough drafts</span>
                    <strong>{draftWalkthroughCount}</strong>
                  </button>
                </div>
              </div>

              <div className="user-dashboard-panel">
                <div className="user-dashboard-panel-title">
                  <strong>Recent Performance</strong>
                  <span>{dashboardScore.scoredCount} scored answers</span>
                </div>
                {latestReports.length === 0 ? (
                  <div className="user-dashboard-empty">No completed reports yet.</div>
                ) : (
                  <div className="user-dashboard-recent">
                    {latestReports.map((report) => {
                      const score = getReportScore(report);

                      return (
                        <button
                          type="button"
                          key={report.id}
                          onClick={() => setSelectedReport(report)}
                        >
                          <span>{report.checklistTitle}</span>
                          <strong>{score.percent === null ? "-" : `${score.percent}%`}</strong>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : null}

          {activeUserPage === "assignments" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>My Assignments</h3>

            {adminAssignedAssignments.length === 0 ? (
              <div style={styles.small}>No active assignments.</div>
            ) : (
              adminAssignedAssignments
                .slice(
                  getVisibleListStart("my-assignments"),
                  getVisibleListCount("my-assignments")
                )
                .map((a) => (
                  <div key={a.id} style={styles.section}>
                    <strong>{a.checklistTitle}</strong>
                    <br />
                    Assigned By: {a.assignedByName}
                    <br />
                    <button
                      style={styles.button}
                      onClick={() => openAssignment(a)}
                    >
                      Open Checklist
                    </button>
                  </div>
                ))
            )}
            <ShowMoreButton
              visibleCount={getVisibleListCount("my-assignments")}
              totalCount={adminAssignedAssignments.length}
              onBack={() => goBackListItems("my-assignments")}
              onClick={() => showMoreListItems("my-assignments")}
            />
          </div>
          ) : null}

          {activeUserPage === "actionPlans" ? (
            <div style={styles.section}>
              <h3 style={styles.title}>Action Plan</h3>
              <div style={{ ...styles.small, marginBottom: 12 }}>
                Items assigned to your email appear here. Update Remarks and choose Done from Status when completed.
              </div>
              {actionPlans.length === 0 ? (
                <div style={styles.small}>No Action Plan items assigned to you.</div>
              ) : (
                <div className="compact-list">
                  {actionPlans.map((plan) => (
                    <div key={plan.id} className="compact-row compact-row-open">
                      <div className="compact-row-title">
                        <strong>{plan.item}</strong>
                        <span>
                          {plan.action} | Due: {plan.dueDate} | Status: {plan.status}
                        </span>
                      </div>
                      <div className="compact-row-form">
                        <label>
                          <span style={styles.label}>Remarks</span>
                          <textarea
                            style={{ ...styles.input, minHeight: 70 }}
                            defaultValue={plan.remarks}
                            onBlur={(event) => {
                              const nextRemarks = event.target.value;
                              if (nextRemarks !== plan.remarks) {
                                saveActionPlanProgress(plan, nextRemarks, plan.status);
                              }
                            }}
                          />
                        </label>
                        <label>
                          <span style={styles.label}>Status</span>
                          <select
                            style={styles.input}
                            value={plan.status}
                            onChange={(event) =>
                              saveActionPlanProgress(
                                plan,
                                plan.remarks,
                                event.target.value as ActionPlanStatus
                              )
                            }
                          >
                            {ACTION_PLAN_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {activeUserPage === "availableTemplates" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Available Templates</h3>
            <div style={styles.small}>
              Choose any template created for your organization and complete it without waiting for an assignment.
            </div>

            {checklists.length === 0 ? (
              <div style={{ ...styles.small, marginTop: 12 }}>No templates are available for your organization.</div>
            ) : (
              <>
                {checklists
                  .slice(
                    getVisibleListStart("available-templates"),
                    getVisibleListCount("available-templates")
                  )
                  .map((checklist) => {
                const hasOpenDraft = selfStartedChecklistIds.has(checklist.id);

                return (
                  <div key={checklist.id} style={styles.section}>
                    <strong>{checklist.title}</strong>
                    {hasOpenDraft ? (
                      <>
                        <br />
                        <span style={styles.small}>You have an open draft for this template.</span>
                      </>
                    ) : null}
                    <br />
                    <button
                      type="button"
                      style={{ ...styles.button, marginTop: 10 }}
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
                      style={{ ...styles.secondaryButton, marginTop: 10, marginLeft: 8 }}
                      onClick={() => handleShareTemplateWithCommunity(checklist)}
                    >
                      Share With Community
                    </button>
                  </div>
                );
              })}
                <ShowMoreButton
                  visibleCount={getVisibleListCount("available-templates")}
                  totalCount={checklists.length}
                  onBack={() => goBackListItems("available-templates")}
              onClick={() => showMoreListItems("available-templates")}
                />
              </>
            )}
          </div>
          ) : null}

          {activeUserPage === "communityTemplates" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Community Templates</h3>
            <div style={styles.small}>
              Templates shared by Inspectria users. Using one copies it into your organization before you edit or complete it.
            </div>

            {communityTemplates.length === 0 ? (
              <div style={{ ...styles.small, marginTop: 12 }}>No community templates have been shared yet.</div>
            ) : (
              <>
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
                      <div key={checklist.communityTemplateId || checklist.id} style={styles.section}>
                        <strong>{checklist.title}</strong>
                        <div style={styles.small}>
                          Shared by {sharedBy}
                          {checklist.sharedByOrganizationName ? ` | ${checklist.sharedByOrganizationName}` : ""}
                        </div>
                        <div style={{ ...styles.small, marginTop: 4 }}>
                          {sectionCount} sections | {questionCount} questions
                        </div>
                        <button
                          type="button"
                          style={{ ...styles.button, marginTop: 10 }}
                          onClick={() => openCommunityTemplate(checklist)}
                          disabled={startingTemplateId === checklist.id}
                        >
                          {startingTemplateId === checklist.id ? "Opening..." : "Use Template"}
                        </button>
                      </div>
                    );
                  })}
                <ShowMoreButton
                  visibleCount={getVisibleListCount("community-templates")}
                  totalCount={communityTemplates.length}
                  onBack={() => goBackListItems("community-templates")}
                  onClick={() => showMoreListItems("community-templates")}
                />
              </>
            )}
          </div>
          ) : null}

          {activeUserPage === "messages" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Messages</h3>
            {messages.length === 0 ? (
              <div style={styles.small}>No messages found.</div>
            ) : (
              <div className="compact-list">
                {messages.map((inboxMessage) => (
                  <div key={inboxMessage.id} className="compact-row compact-row-open">
                    <div className="compact-row-main">
                      <div
                        className="message-status-dot"
                        title={inboxMessage.readAt ? "Read" : "Unread"}
                      />
                      <div className="compact-row-title">
                        <strong>{inboxMessage.title}</strong>
                        <span>{inboxMessage.body}</span>
                        <span>
                          Template import requires an admin account. Please ask your admin to import it from Messages.
                        </span>
                      </div>
                    </div>
                    <div className="compact-row-meta">
                      <span>{inboxMessage.readAt ? "Read" : "Unread"}</span>
                    </div>
                    <div className="compact-row-actions">
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
                ))}
              </div>
            )}
          </div>
          ) : null}


          {activeUserPage === "walkthroughs" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Walkthrough</h3>
            <div style={styles.small}>
              Create an on-the-go inspection without an admin assignment. Add sections, comments, and photos as you walk the area.
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
                      <div key={itemIndex} className="walkthrough-comment-card" style={{ ...styles.section, background: "#fff" }}>
                        <div className="walkthrough-comment-layout">
                          <div>
                            <label className="walkthrough-field-label">Observation / Comment</label>
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
                          <div className="photo-upload-actions">
                            <label className="file-upload-button">
                              <span>Take Photo</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => {
                                  handleWalkthroughPhotos(sectionIndex, itemIndex, e.target.files);
                                  e.currentTarget.value = "";
                                }}
                              />
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
                          </div>
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

                        <div className="walkthrough-comment-actions" style={{ ...styles.row, marginTop: 10 }}>
                          <button
                            type="button"
                            style={styles.secondaryButton}
                            onClick={() => addWalkthroughItem(sectionIndex)}
                          >
                            New Comment
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
                <button type="button" style={styles.secondaryButton} onClick={() => saveWalkthrough("draft")}>
                  Save Draft
                </button>
                <button type="button" style={styles.button} onClick={() => saveWalkthrough("completed")}>
                  Complete Walkthrough
                </button>
              </div>
            </div>

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
                  Sections: {walkthrough.sections.length}
                  <br />
                  Comments: {walkthrough.sections.reduce((total, section) => total + section.items.length, 0)}
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
                      onClick={() => handleDeleteWalkthrough(walkthrough)}
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
          ) : null}

          {activeUserPage === "reports" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>My Reports</h3>

            {reports.length === 0 ? (
              <div style={styles.small}>No reports yet.</div>
            ) : (
              <>
                {reports
                  .slice(getVisibleListStart("reports"), getVisibleListCount("reports"))
                  .map((r) => (
                <div key={r.id} style={styles.section}>
                  <strong>{r.checklistTitle}</strong>
                  <br />
                  Completed By: {r.completedByName}
                  <br />
                  Status: {r.status}
                  <br />
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => setSelectedReport(r)}
                    >
                      View Report
                    </button>
                    <button
                      style={styles.button}
                      onClick={() => handleDownloadPdf(r)}
                    >
                      Download PDF
                    </button>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => handleEmailReport(r)}
                    >
                      Email Report
                    </button>
                    <button
                      style={styles.button}
                      onClick={() => handleDownloadManagerSummary(r)}
                      disabled={managerSummaryReportId === r.id}
                    >
                      {managerSummaryReportId === r.id ? "Preparing Summary..." : "Manager Summary"}
                    </button>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => handleDeleteReport(r)}
                    >
                      Delete Report
                    </button>
                  </div>
                </div>
              ))}
                <ShowMoreButton
                  visibleCount={getVisibleListCount("reports")}
                  totalCount={reports.length}
                  onBack={() => goBackListItems("reports")}
              onClick={() => showMoreListItems("reports")}
                />
              </>
            )}
          </div>
          ) : null}

          {activeUserPage === "account" ? (
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
                  onChange={(event) => setAccountPassword(event.target.value)}
                />
                <PasswordInput
                  placeholder="Confirm New Password"
                  value={accountPasswordConfirm}
                  onChange={(event) => setAccountPasswordConfirm(event.target.value)}
                />
              </div>
              <button type="button" style={styles.button} onClick={handleChangeOwnPassword}>
                Change Password
              </button>
            </div>
          </div>
          ) : null}

          {activeUserPage === "support" ? (
          <div className="support-page">
            <div className="support-hero">
              <div>
                <span>INSPECTRIA SUPPORT</span>
                <h1>How can we help?</h1>
                <p>
                  Explore what you can do based on your role, or send an issue directly to the
                  Inspectria Support team.
                </p>
              </div>
            </div>

            <section className="support-section" aria-labelledby="user-support-roles-title">
              <div className="support-section-heading">
                <span>ROLE GUIDE</span>
                <h2 id="user-support-roles-title">What can you do in Inspectria?</h2>
              </div>
              <div className="support-role-grid">
                {ROLE_GUIDES.map((guide) => {
                  const isCurrentRole =
                    guide.key === user.role ||
                    (guide.key === "topLevel" && user.role === "admin");

                  return (
                    <article
                      className={`support-role-card${isCurrentRole ? " support-role-card-current" : ""}`}
                      key={guide.key}
                    >
                      {isCurrentRole ? (
                        <div className="support-current-role">YOUR ROLE</div>
                      ) : null}
                      <h3>{guide.title}</h3>
                      <p>{guide.description}</p>
                      <ul>
                        {guide.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="support-ticket-section" aria-labelledby="user-ticket-title">
              <div className="support-ticket-copy">
                <span>CREATE A TICKET</span>
                <h2 id="user-ticket-title">Are you experiencing an issue?</h2>
                <p>
                  Describe your issue in as much detail as possible. Your ticket will be sent
                  together with your account, role, and organization details.
                </p>
                <p className="support-ticket-email">Sent to: info@inspectria.com</p>
              </div>
              <form className="support-ticket-form" onSubmit={submitSupportTicket}>
                <label>
                  Subject
                  <input
                    value={supportSubject}
                    onChange={(event) => setSupportSubject(event.target.value)}
                    maxLength={180}
                    required
                    placeholder="For example: I cannot see my checklist assignment"
                  />
                </label>
                <label>
                  Your issue
                  <textarea
                    value={supportMessage}
                    onChange={(event) => setSupportMessage(event.target.value)}
                    maxLength={4000}
                    required
                    placeholder="Tell us what you were trying to do and what happened."
                  />
                </label>
                {supportStatus ? (
                  <div
                    className={
                      supportStatus.startsWith("Your ticket has")
                        ? "support-ticket-success"
                        : "support-ticket-error"
                    }
                  >
                    {supportStatus}
                  </div>
                ) : null}
                <button type="submit" style={styles.button} disabled={supportSending}>
                  {supportSending ? "Sending..." : "Send support ticket"}
                </button>
              </form>
            </section>
          </div>
          ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={styles.section}>
          {(activeChecklist.image_path || activeChecklist.imagePath) ? (
            <img
              src={resolveFileUrl(activeChecklist.image_path || activeChecklist.imagePath || "")}
              alt={activeChecklist.title}
              style={{
                width: "25%",
                minWidth: 120,
                maxWidth: 220,
                height: "auto",
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid #d7e6e4",
                marginBottom: 14,
                display: "block",
              }}
            />
          ) : null}
          <h3 style={styles.title}>{activeChecklist.title}</h3>

          <div style={{ ...styles.section, background: "#fff", marginTop: 10 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <strong>Completion {checklistProgress.percent}%</strong>
              <span style={styles.small}>
                {checklistProgress.answered} of {checklistProgress.total} questions answered
              </span>
            </div>
            <div
              aria-label={`Completion ${checklistProgress.percent}%`}
              style={{
                height: 10,
                borderRadius: 999,
                background: "#d7e6e4",
                overflow: "hidden",
                marginTop: 10,
              }}
            >
              <div
                style={{
                  width: `${checklistProgress.percent}%`,
                  height: "100%",
                  background: checklistProgress.percent === 100 ? "#16a34a" : "#0f766e",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>

          {activeSection ? (
            <>
              <div
                style={{
                  ...styles.section,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                  background: "#eef8f6",
                }}
              >
                <div>
                  <div style={styles.small}>
                    Section {activeSectionIndex + 1} of {sectionCount}
                  </div>
                  <h3 style={{ margin: "4px 0 0", color: "#0f766e" }}>
                    {activeSectionIndex + 1}. {activeSection.title}
                  </h3>
                  <div style={{ ...styles.small, marginTop: 6 }}>
                    Section progress: {activeSectionProgress.answered} of{" "}
                    {activeSectionProgress.total} answered ({activeSectionProgress.percent}%)
                  </div>
                </div>
                <div style={styles.row}>
                  <button
                    type="button"
                    style={{
                      ...styles.secondaryButton,
                      opacity: isFirstSection ? 0.55 : 1,
                      cursor: isFirstSection ? "not-allowed" : "pointer",
                    }}
                    onClick={() => goToSection(activeSectionIndex - 1)}
                    disabled={isFirstSection}
                  >
                    Previous Section
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.button,
                      opacity: isLastSection ? 0.55 : 1,
                      cursor: isLastSection ? "not-allowed" : "pointer",
                    }}
                    onClick={() => goToSection(activeSectionIndex + 1)}
                    disabled={isLastSection}
                  >
                    Next Section
                  </button>
                </div>
              </div>

              <div key={activeSection.id} style={styles.section}>
                {activeSection.items.map((item, index) => (
                <div
                  key={item.id}
                  ref={(element) => {
                    questionRefs.current[item.id] = element;
                  }}
                  style={{
                    ...styles.section,
                    background: item.parentItemId ? "#f8fafc" : "#fff",
                    marginLeft: item.parentItemId ? 18 : undefined,
                    borderLeft: item.parentItemId ? "4px solid #0f766e" : undefined,
                  }}
                >
                  {item.parentItemId ? (
                    <div style={{ ...styles.small, marginBottom: 6 }}>
                      Conditional question
                    </div>
                  ) : null}
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
                        onChange={(e) => updateAnswer(item.id, e.target.value)}
                      />
                    </div>
                  ) : null}

                  {(item.answerType || item.answer_type) === "TEXT" ? (
                    <div style={{ marginTop: 10 }}>
                      <textarea
                        style={{ ...styles.input, minHeight: 90 }}
                        placeholder="Answer"
                        value={form[item.id]?.answer || ""}
                        onChange={(e) => updateAnswer(item.id, e.target.value)}
                      />
                    </div>
                  ) : null}

                  {(item.answerType || item.answer_type) === "MULTIPLE_CHOICE" ? (
                    <div style={{ marginTop: 10 }}>
                      <select
                        style={styles.input}
                        value={form[item.id]?.answer || ""}
                        onChange={(e) => updateAnswer(item.id, e.target.value)}
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
                    <div
                      style={{
                        display: "grid",
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
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
                            background:
                              isChecked ? "#e6f3f1" : "#fff",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          <input
                            type="checkbox"
                            name={`question-${item.id}`}
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
                      onChange={(e) =>
                        setForm((prev) => {
                          const nextForm = {
                            ...prev,
                            [item.id]: {
                              ...prev[item.id],
                              comment: e.target.value,
                            },
                          };

                          if (activeAssignmentIdRef.current) {
                            persistDraft(activeAssignmentIdRef.current, nextForm);
                          }

                          return nextForm;
                        })
                      }
                    />
                  </div>

                  <div
                    style={{ marginTop: 12 }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleAddPhotos(item.id, e.dataTransfer.files);
                    }}
                  >
                    <label
                      htmlFor={`photo-upload-${item.id}`}
                      style={{ display: "block", marginBottom: 6, fontWeight: 600 }}
                    >
                      Add Photos
                    </label>
                    <div className="photo-upload-actions">
                      <label className="file-upload-button" htmlFor={`photo-capture-${item.id}`}>
                        <span>Take Photo</span>
                        <input
                          id={`photo-capture-${item.id}`}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => {
                            handleAddPhotos(item.id, e.target.files);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <label className="file-upload-button" htmlFor={`photo-upload-${item.id}`}>
                        <span>Choose File</span>
                        <input
                          id={`photo-upload-${item.id}`}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            handleAddPhotos(item.id, e.target.files);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {uploadingItemId === item.id ? (
                      <div style={{ marginTop: 8, color: "#0f766e", fontSize: 13 }}>
                        Uploading photos...
                      </div>
                    ) : null}
                    <div style={{ ...styles.small, marginTop: 8 }}>
                      You can also drag and drop photos here.
                    </div>
                  </div>

                  {form[item.id]?.photos?.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                        gap: 12,
                        marginTop: 12,
                      }}
                    >
                      {form[item.id].photos.map((photo, idx) => {
                        const src = resolveFileUrl(photo);

                        return (
                          <div
                            key={idx}
                            style={{
                              border: "1px solid #d7e6e4",
                              borderRadius: 12,
                              padding: 10,
                              background: "#fbfefd",
                            }}
                          >
                            <img
                              src={src}
                              alt={`uploaded-${idx}`}
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
                              onClick={() => removePhoto(item.id, idx)}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                ))}
              </div>
            </>
          ) : null}

          <div style={styles.row}>
            <button
              style={styles.secondaryButton}
              onClick={() => {
                saveAndContinueLater();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={saveAndContinueLater}
            >
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
              <button style={styles.button} onClick={submit}>
                Complete Checklist
              </button>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
