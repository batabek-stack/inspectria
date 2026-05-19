import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import {
  AnswerType,
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
import DesktopFilePicker from "../components/DesktopFilePicker";
import PasswordInput from "../components/PasswordInput";
import ReportDetail from "../components/ReportDetail";
import ManagerSummaryPanel from "../components/ManagerSummaryPanel";
import WalkthroughDetail from "../components/WalkthroughDetail";
import { createAssignment, getAssignments } from "../services/assignmentService";
import {
  createChecklist,
  updateChecklist,
  deleteChecklist,
  forceDeleteChecklist,
  getChecklists,
} from "../services/checklistService";
import { deleteReport, getReports } from "../services/reportService";
import {
  createWalkthrough,
  deleteWalkthrough,
  getWalkthroughs,
  updateWalkthrough,
} from "../services/walkthroughService";
import {
  createPasswordResetLink,
  createUser,
  deleteUser,
  getUsers,
  updateUser,
} from "../services/userService";
import {
  createOrganization,
  getOrganizations,
  updateOrganization,
} from "../services/organizationService";
import { emailReport } from "../services/emailService";
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
  createServerDownload,
  copyLocalImageToUploads,
  FILE_BASE,
  getLocalFileBlob,
  uploadPhotos,
} from "../services/api";
import {
  createDownloadFromUrl,
  GeneratedDownload,
  openDownload,
  revokeDownload,
} from "../utils/downloadFile";

type Props = {
  user: User;
  onLogout: () => Promise<void>;
};

type SectionForm = {
  title: string;
  items: QuestionForm[];
};

type QuestionForm = {
  question: string;
  answerType: AnswerType;
  options: string[];
};

type AdminSectionKey =
  | "organizations"
  | "billing"
  | "templates"
  | "assignments"
  | "walkthroughs"
  | "users"
  | "reports"
  | "account";

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  FORMAT1: "Yes / No / N/A",
  DATE: "Date",
  TEXT: "Text",
  MULTIPLE_CHOICE: "Dropdown",
  RADIO_BUTTON: "Check Box",
};

const ALLOWED_IMPORT_EXTENSIONS = new Set([".xlsx", ".csv"]);

const ADMIN_SECTIONS: Array<{
  key: AdminSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: "organizations",
    label: "Organizations",
    description: "Manage SaaS tenants and admins",
  },
  {
    key: "billing",
    label: "Billing",
    description: "Manage plans and subscriptions",
  },
  {
    key: "templates",
    label: "Templates",
    description: "Create and manage checklist templates",
  },
  {
    key: "assignments",
    label: "Assignments",
    description: "Assign checklist work to users",
  },
  {
    key: "walkthroughs",
    label: "Walkthrough",
    description: "Prepare on-the-go inspection lists",
  },
  {
    key: "users",
    label: "User Management",
    description: "Approve, create, and edit users",
  },
  {
    key: "reports",
    label: "Completed Reports",
    description: "Review reports and export files",
  },
  {
    key: "account",
    label: "My Account",
    description: "Change your password",
  },
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

function extractImportedQuestions(rows: unknown[][]) {
  const normalizedRows = rows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some(Boolean));

  if (normalizedRows.length === 0) return [];

  const firstRow = normalizedRows[0].map((cell) => cell.toLowerCase());
  const questionColumnIndex = firstRow.findIndex((cell) =>
    ["question", "questions", "soru", "sorular"].includes(cell)
  );
  const hasHeader = questionColumnIndex >= 0;
  const columnIndex = hasHeader
    ? questionColumnIndex
    : normalizedRows[0].findIndex(Boolean);
  const sourceRows = hasHeader ? normalizedRows.slice(1) : normalizedRows;

  if (columnIndex < 0) return [];

  return sourceRows
    .map((row) => row[columnIndex])
    .map((question) => String(question || "").trim())
    .filter(Boolean);
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
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return value;
  }
}

function groupUsersByOrganization(users: User[], organizations: Organization[]) {
  const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));
  const grouped = new Map<
    string,
    {
      key: string;
      organizationId: number | null;
      organization?: Organization;
      name: string;
      users: User[];
    }
  >();

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
      sectionTitle: item.sectionTitle || "",
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

export default function AdminPage({ user, onLogout }: Props) {
  const isPlatformAdmin = user.role === "platform_admin";
  const [activeAdminPage, setActiveAdminPage] = useState<AdminSectionKey>(
    isPlatformAdmin ? "organizations" : "templates"
  );
  const visibleAdminSections = ADMIN_SECTIONS.filter(
    (section) => isPlatformAdmin || section.key !== "organizations"
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<Walkthrough | null>(null);
  const [walkthroughTitle, setWalkthroughTitle] = useState("");
  const [walkthroughLocation, setWalkthroughLocation] = useState("");
  const [walkthroughSections, setWalkthroughSections] = useState<WalkthroughSection[]>([
    { title: "General", items: [{ comment: "", severity: "", photos: [] }] },
  ]);
  const [editingWalkthroughId, setEditingWalkthroughId] = useState<number | null>(null);
  const [walkthroughUploadingKey, setWalkthroughUploadingKey] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [templateImagePath, setTemplateImagePath] = useState("");
  const [templateImageUploading, setTemplateImageUploading] = useState(false);
  const [sections, setSections] = useState<SectionForm[]>([
    {
      title: "",
      items: [createEmptyQuestion()],
    },
  ]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggedQuestion, setDraggedQuestion] = useState<{
    sectionIndex: number;
    questionIndex: number;
  } | null>(null);

  const [selectedChecklistId, setSelectedChecklistId] = useState<number>(0);
  const [selectedUserId, setSelectedUserId] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [managerSummaryReportId, setManagerSummaryReportId] = useState<number | null>(null);
  const [generatedDownload, setGeneratedDownload] = useState<GeneratedDownload | null>(null);
  const [managerSummaryPreview, setManagerSummaryPreview] = useState<{
    report: Report;
    summary: ManagerSummaryResponse;
  } | null>(null);

  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgPlan, setNewOrgPlan] = useState("standard");
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

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [newUserOrganizationId, setNewUserOrganizationId] = useState<number>(0);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [passwordResetLinks, setPasswordResetLinks] = useState<Record<number, string>>({});
  const [passwordResetLinkLoadingId, setPasswordResetLinkLoadingId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState("");
  const [pendingUserForms, setPendingUserForms] = useState<
    Record<number, { username: string; name: string }>
  >({});
  const pendingUsers = users.filter((u) => u.approvalStatus === "pending");
  const approvedUsers = users.filter(
    (u) => u.approvalStatus !== "pending" && u.role !== "platform_admin"
  );
  const pendingUserGroups = groupUsersByOrganization(pendingUsers, organizations);
  const approvedUserGroups = groupUsersByOrganization(approvedUsers, organizations);

  const load = async () => {
    const [orgs, u, c, a, r, w, billingSummary] = await Promise.all([
      isPlatformAdmin ? getOrganizations() : Promise.resolve([]),
      getUsers(),
      getChecklists(),
      getAssignments(),
      getReports(),
      getWalkthroughs(),
      getBillingSummary(),
    ]);

    setOrganizations(orgs);
    setUsers(u);
    setChecklists(c);
    setAssignments(a);
    setReports(r);
    setWalkthroughs(w);
    setBilling(billingSummary);
    setPendingUserForms((prev) => {
      const next = { ...prev };

      u.filter((candidate) => candidate.approvalStatus === "pending").forEach((candidate) => {
        next[candidate.id] = next[candidate.id] || {
          username: candidate.username,
          name: candidate.name,
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
      (x) => x.role === "user" && x.active !== false && x.approvalStatus !== "pending"
    );
    if (!selectedUserId && assignableUsers[0]) {
      setSelectedUserId(assignableUsers[0].id);
    }

    if (isPlatformAdmin && !billingOrganizationId && orgs[0]) {
      setBillingOrganizationId(orgs[0].id);
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

  const resetTemplateForm = () => {
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

  const handleTemplateImageFromDesktop = async (path: string) => {
    try {
      setTemplateImageUploading(true);
      setError("");
      const uploaded = await copyLocalImageToUploads(path);
      setTemplateImagePath(uploaded[0] || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template image could not be selected");
    } finally {
      setTemplateImageUploading(false);
    }
  };

  const handleImportQuestionsFromExcel = async (file: File | null) => {
    if (!file) return;

    setMessage("");
    setError("");

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

      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[firstSheetName],
        { header: 1, blankrows: false }
      );
      const importedQuestions = extractImportedQuestions(rows);

      if (importedQuestions.length === 0) {
        setError("No questions found. Use a 'Question' column or put questions in the first column.");
        return;
      }

      setEditingId(null);
      setTitle((currentTitle) => currentTitle || "Imported Template");
      setSections([
        {
          title: "Imported Questions",
          items: importedQuestions.map((question) => ({
            question,
            answerType: "FORMAT1",
            options: [""],
          })),
        },
      ]);
      setActiveAdminPage("templates");
      setMessage(`${importedQuestions.length} questions imported. Review sections and question types before saving.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Excel import failed");
    }
  };

  const handleImportQuestionsFromDesktop = async (path: string, name: string) => {
    const blob = await getLocalFileBlob(path);
    const file = new File([blob], name);
    await handleImportQuestionsFromExcel(file);
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
      setError("Dropdown ve Check Box sorulari icin en az bir secenek girilmelidir.");
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

  const handleEmailReport = async (report: Report) => {
    const to = window.prompt("Send report to which email address?");
    if (!to) return;

    setMessage("");
    setError("");

    try {
      setMessage("Preparing report email...");
      const pdfPayload = mapReportToPdfPayload(report);
      const pdf = await generateChecklistPdf(pdfPayload as any, { output: "dataUri" });

      await emailReport({
        reportType: "checklist",
        reportId: report.id,
        to,
        subject: `Inspectria Checklist Report: ${report.checklistTitle}`,
        message: "Please find the Inspectria checklist report attached.",
        attachmentBase64: pdf.dataUri,
        attachmentFileName: pdf.fileName,
      });

      setMessage("Report email sent.");
    } catch (err) {
      setMessage("");
      setError(err instanceof Error ? err.message : "Report email could not be sent.");
    }
  };

  const handleEmailWalkthrough = async (walkthrough: Walkthrough) => {
    const to = window.prompt("Send walkthrough report to which email address?");
    if (!to) return;

    setMessage("");
    setError("");

    try {
      setMessage("Preparing walkthrough email...");
      const pdfPayload = mapWalkthroughToPdfPayload(walkthrough);
      const pdf = await generateChecklistPdf(pdfPayload as any, { output: "dataUri" });

      await emailReport({
        reportType: "walkthrough",
        reportId: walkthrough.id,
        to,
        subject: `Inspectria Walkthrough Report: ${walkthrough.title}`,
        message: "Please find the Inspectria walkthrough report attached.",
        attachmentBase64: pdf.dataUri,
        attachmentFileName: pdf.fileName,
      });

      setMessage("Walkthrough email sent.");
    } catch (err) {
      setMessage("");
      setError(err instanceof Error ? err.message : "Walkthrough email could not be sent.");
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
      newOrgAdminUsername.trim() ||
      newOrgAdminPassword.trim() ||
      newOrgAdminName.trim();

    if (
      hasAdminInput &&
      (!newOrgAdminUsername.trim() ||
        !newOrgAdminPassword.trim() ||
        !newOrgAdminName.trim())
    ) {
      setError("Admin username, password and full name are required together.");
      return;
    }

    try {
      await createOrganization({
        name: newOrgName.trim(),
        plan: newOrgPlan.trim() || "standard",
        ...(hasAdminInput
          ? {
              adminUsername: newOrgAdminUsername.trim(),
              adminPassword: newOrgAdminPassword,
              adminName: newOrgAdminName.trim(),
            }
          : {}),
      });

      setNewOrgName("");
      setNewOrgPlan("standard");
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
      await updateUser(targetUser.id, {
        approvalStatus: "approved",
        active: true,
        role: "admin",
      });
      setMessage(`${targetUser.name} approved as organization admin.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization admin could not be approved");
    }
  };

  const handleCreateUser = async () => {
    setMessage("");
    setError("");

    if (!newUsername.trim() || !newPassword.trim() || !newName.trim()) {
      setError("Username, password and full name are required.");
      return;
    }

    if (isPlatformAdmin && !newUserOrganizationId) {
      setError("Organization selection is required for platform admin.");
      return;
    }

    try {
      await createUser({
        username: newUsername.trim(),
        password: newPassword,
        name: newName.trim(),
        role: newRole,
        ...(isPlatformAdmin ? { organizationId: newUserOrganizationId } : {}),
      });

      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRole("user");
      setNewUserOrganizationId(0);
      setMessage("User created successfully.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User could not be created");
    }
  };

  const startEditUser = (targetUser: User) => {
    setEditingUserId(targetUser.id);
    setEditUsername(targetUser.username);
    setEditPassword("");
    setEditName(targetUser.name);
    setEditRole(targetUser.role === "admin" ? "admin" : "user");
    setMessage("");
    setError("");
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUsername("");
    setEditPassword("");
    setEditName("");
    setEditRole("user");
  };

  const handleUpdateUser = async () => {
    if (!editingUserId) return;

    setMessage("");
    setError("");

    if (!editUsername.trim() || !editName.trim()) {
      setError("Username and full name are required.");
      return;
    }

    try {
      await updateUser(editingUserId, {
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
    };

    if (!pendingForm.username.trim() || !pendingForm.name.trim()) {
      setError("Username and full name are required before approval.");
      return;
    }

    try {
      await updateUser(targetUser.id, {
        username: pendingForm.username.trim(),
        name: pendingForm.name.trim(),
        approvalStatus: "approved",
        active: true,
        role: "user",
      });
      setMessage(`${targetUser.username} approved successfully.`);
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

  const handleWalkthroughDesktopPhoto = async (
    sectionIndex: number,
    itemIndex: number,
    path: string
  ) => {
    const key = `${sectionIndex}-${itemIndex}`;
    try {
      setWalkthroughUploadingKey(key);
      const uploaded = await copyLocalImageToUploads(path);
      const currentPhotos = walkthroughSections[sectionIndex]?.items[itemIndex]?.photos || [];
      updateWalkthroughItem(sectionIndex, itemIndex, {
        photos: [...currentPhotos, ...uploaded],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo selection failed");
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

  return (
    <DashboardShell user={user} onLogout={onLogout}>
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
            onDownloadManagerSummary={handleDownloadManagerSummary}
            managerSummaryLoading={managerSummaryReportId === selectedReport.id}
          />
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {visibleAdminSections.map((section) => {
              const isActive = activeAdminPage === section.key;

              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => {
                    setActiveAdminPage(section.key);
                    setSelectedReport(null);
                    setMessage("");
                    setError("");
                  }}
                  style={{
                    border: isActive ? "2px solid #0f766e" : "1px solid #d7e6e4",
                    borderRadius: 10,
                    background: isActive ? "#e6f3f1" : "#fff",
                    color: "#092934",
                    cursor: "pointer",
                    padding: "12px 14px",
                    textAlign: "left",
                    minHeight: 74,
                    boxShadow: isActive ? "0 2px 8px rgba(15,118,110,0.16)" : "none",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{section.label}</div>
                  <div style={{ fontSize: 12, color: "#5e7378", lineHeight: 1.3 }}>
                    {section.description}
                  </div>
                </button>
              );
            })}
          </div>

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

          {activeAdminPage === "organizations" && isPlatformAdmin ? (
            <div style={styles.section}>
              <h3 style={styles.title}>Organizations</h3>

              <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Create Organization</h4>
                <div style={{ ...styles.row, marginBottom: 12 }}>
                  <input
                    style={styles.input}
                    placeholder="Organization name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Plan"
                    value={newOrgPlan}
                    onChange={(e) => setNewOrgPlan(e.target.value)}
                  />
                </div>

                <div style={{ ...styles.row, marginBottom: 12 }}>
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
                  Create Organization
                </button>
              </div>

              {organizations.length === 0 ? (
                <div style={styles.small}>No organizations found.</div>
              ) : (
                organizations.map((organization) => {
                  const pendingAdmins = organization.admins.filter(
                    (admin) => admin.approvalStatus === "pending"
                  );

                  return (
                    <div key={organization.id} style={styles.section}>
                      <div
                        style={{
                          ...styles.row,
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <strong>{organization.name}</strong>
                          <div style={styles.small}>
                            Plan: {organization.plan} | Status:{" "}
                            {organization.active ? "active" : "inactive"}
                          </div>
                        </div>
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
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                          gap: 10,
                          marginTop: 12,
                        }}
                      >
                        <div style={{ ...styles.section, marginTop: 0 }}>
                          <strong>{organization.userCount}</strong>
                          <br />
                          <span style={styles.small}>Users</span>
                        </div>
                        <div style={{ ...styles.section, marginTop: 0 }}>
                          <strong>{organization.adminCount}</strong>
                          <br />
                          <span style={styles.small}>Admins</span>
                        </div>
                        <div style={{ ...styles.section, marginTop: 0 }}>
                          <strong>{organization.inspectorCount}</strong>
                          <br />
                          <span style={styles.small}>Inspectors</span>
                        </div>
                        <div style={{ ...styles.section, marginTop: 0 }}>
                          <strong>{organization.reportCount}</strong>
                          <br />
                          <span style={styles.small}>Reports</span>
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <strong>Organization Admins</strong>
                        {organization.admins.length === 0 ? (
                          <div style={styles.small}>No admin user yet.</div>
                        ) : (
                          organization.admins.map((admin) => (
                            <div key={admin.id} style={{ ...styles.section, background: "#fff" }}>
                              <strong>{admin.name}</strong> ({admin.username}) -{" "}
                              {admin.approvalStatus}
                              {admin.active === false ? " / inactive" : ""}
                              {admin.approvalStatus === "pending" ? (
                                <div style={{ ...styles.row, marginTop: 10 }}>
                                  <button
                                    style={styles.button}
                                    onClick={() => handleApproveOrganizationAdmin(admin)}
                                  >
                                    Approve Admin
                                  </button>
                                  <button
                                    style={styles.secondaryButton}
                                    onClick={() => handleDeleteUser(admin.id)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>

                      {pendingAdmins.length > 0 ? (
                        <div style={{ ...styles.small, marginTop: 8 }}>
                          {pendingAdmins.length} admin approval waiting.
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {activeAdminPage === "billing" ? (
            <div style={styles.section}>
              <h3 style={styles.title}>Billing & Subscription</h3>

              <div
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
                      : "Select a plan to start or renew."}
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

              {!isPlatformAdmin ? (
                <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                  <h4 style={{ ...styles.title, marginBottom: 10 }}>
                    Renew or Change Subscription
                  </h4>
                  <div style={{ ...styles.row, marginBottom: 12 }}>
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
                    <input
                      style={styles.input}
                      placeholder="Payment method / invoice note"
                      value={billingPaymentMethod}
                      onChange={(e) => setBillingPaymentMethod(e.target.value)}
                    />
                  </div>

                  {selectedBillingPlan ? (
                    <div style={{ ...styles.small, marginBottom: 12 }}>
                      Selected: {selectedBillingPlan.name} |{" "}
                      {billingCycle === "yearly"
                        ? formatMoney(selectedBillingPlan.yearlyPriceCents)
                        : formatMoney(selectedBillingPlan.monthlyPriceCents)}
                      {" / "}
                      {billingCycle} | {formatLimit(selectedBillingPlan.userLimit, "users")} |{" "}
                      {formatLimit(selectedBillingPlan.checklistLimit, "templates")}
                    </div>
                  ) : null}

                  <div style={styles.row}>
                    <button type="button" style={styles.button} onClick={handleRenewCurrentSubscription}>
                      Pay with iyzico
                    </button>
                    {currentSubscription ? (
                      <button
                        type="button"
                        style={{ ...styles.secondaryButton, background: "#fee2e2", color: "#991b1b" }}
                        onClick={handleCancelCurrentSubscription}
                      >
                        Cancel Subscription
                      </button>
                    ) : null}
                  </div>

                  {iyzicoCheckoutContent ? (
                    <div style={{ ...styles.section, marginTop: 14, background: "#fbfefd" }}>
                      <div style={{ ...styles.row, justifyContent: "space-between" }}>
                        <strong>iyzico Secure Checkout</strong>
                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={() => {
                            setIyzicoCheckoutContent("");
                            setIyzicoCheckoutToken("");
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <div style={{ ...styles.small, marginTop: 8 }}>
                        Token: {iyzicoCheckoutToken}
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <IyzicoCheckout content={iyzicoCheckoutContent} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isPlatformAdmin ? (
              <div style={{ ...styles.section, background: "#fff", marginTop: 0 }}>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Activate Subscription</h4>
                <div style={{ ...styles.row, marginBottom: 12 }}>
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
                <div style={{ ...styles.row, marginBottom: 12 }}>
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
              </div>
              ) : null}

              <div
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
                    <button
                      type="button"
                      style={{ ...styles.secondaryButton, marginTop: 10 }}
                      onClick={() => setBillingPlanId(plan.id)}
                    >
                      Select
                    </button>
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
          ) : null}

          {activeAdminPage === "templates" ? (
            <>
          <div style={styles.section}>
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
                Import Questions from Excel
              </label>
              <input
                id="question-import-file"
                type="file"
                accept=".xlsx,.csv"
                style={{ display: "block", marginTop: 8, marginBottom: 8 }}
                onChange={(e) => {
                  handleImportQuestionsFromExcel(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              <div style={{ ...styles.small, marginTop: 8 }}>
                Use .xlsx or .csv files only. Macro-enabled and legacy Excel files are blocked.
                The file can contain only a Question column, or questions in the first filled column.
                You can also drag and drop the file here.
              </div>
              <DesktopFilePicker
                kind="spreadsheet"
                onSelect={(file) => handleImportQuestionsFromDesktop(file.path, file.name)}
              />
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
              <input
                id="template-image-file"
                type="file"
                accept="image/*"
                style={{ display: "block", marginTop: 8, marginBottom: 8 }}
                onChange={(e) => {
                  handleTemplateImageUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              {templateImageUploading ? (
                <div style={{ ...styles.small, marginTop: 8 }}>Uploading image...</div>
              ) : null}
              <div style={{ ...styles.small, marginTop: 8 }}>
                You can also drag and drop an image here.
              </div>
              <DesktopFilePicker
                kind="image"
                onSelect={(file) => handleTemplateImageFromDesktop(file.path)}
              />
              {templateImagePath ? (
                <div style={{ marginTop: 12 }}>
                  <img
                    src={templateImagePath.startsWith("http") ? templateImagePath : `${FILE_BASE}${templateImagePath}`}
                    alt="Template"
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

          <div style={styles.section}>
            <h3 style={styles.title}>Templates</h3>

            {checklists.length === 0 ? (
              <div style={styles.small}>No templates found.</div>
            ) : (
              checklists.map((c) => (
                <div key={c.id} style={styles.section}>
                  {(c.image_path || c.imagePath) ? (
                    <img
                      src={(c.image_path || c.imagePath || "").startsWith("http") ? (c.image_path || c.imagePath) : `${FILE_BASE}${c.image_path || c.imagePath}`}
                      alt={c.title}
                      style={{
                        width: "25%",
                        minWidth: 100,
                        maxWidth: 180,
                        height: "auto",
                        objectFit: "contain",
                        borderRadius: 10,
                        border: "1px solid #d7e6e4",
                        marginBottom: 10,
                        display: "block",
                      }}
                    />
                  ) : null}
                  <strong>{c.title}</strong>
                  <br />
                  Sections: {Array.isArray(c.sections) ? c.sections.length : 0}
                  <br />
                  <div style={{ marginTop: 8 }}>
                    {Array.isArray(c.sections) &&
                      c.sections.map((section) => (
                        <div key={section.id} style={{ marginBottom: 6 }}>
                          <strong>- {section.title}</strong> ({section.items.length} questions)
                        </div>
                      ))}
                  </div>
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => startEditTemplate(c)}
                    >
                      Edit Template
                    </button>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => handleDuplicateTemplate(c)}
                    >
                      Copy Template
                    </button>
                    <button
                      style={styles.button}
                      onClick={() => handleDeleteTemplate(c.id)}
                    >
                      Delete Template
                    </button>
                    <button
                      style={{ ...styles.button, background: "#b91c1c" }}
                      onClick={() => handleForceDeleteTemplate(c.id)}
                    >
                      Force Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
            </>
          ) : null}

          {activeAdminPage === "assignments" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Assignments</h3>

            <div style={{ ...styles.row, marginBottom: 12 }}>
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
                      u.role === "user" &&
                      u.active !== false &&
                      u.approvalStatus !== "pending"
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>

              <button style={styles.button} onClick={assign}>
                Assign
              </button>
            </div>

            {assignments.map((a) => (
              <div key={a.id} style={styles.section}>
                <strong>{a.checklistTitle}</strong>
                <br />
                Assigned To: {a.assignedToName}
                <br />
                Assigned By: {a.assignedByName}
                <br />
                Status: {a.status}
              </div>
            ))}
          </div>
          ) : null}

          {activeAdminPage === "users" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>User Management</h3>

            {isPlatformAdmin && (
              <div style={{ ...styles.small, marginBottom: 12 }}>
                Users are grouped by organization. Platform admin accounts are hidden from this list.
              </div>
            )}

            {pendingUsers.length > 0 ? (
              <div style={{ ...styles.section, background: "#fff8e6", marginBottom: 14 }}>
                <h4 style={{ ...styles.title, marginBottom: 10 }}>Pending Approval</h4>

                {(isPlatformAdmin ? pendingUserGroups : [{ key: "current", name: "", users: pendingUsers }]).map((group) => (
                  <div key={group.key} style={isPlatformAdmin ? styles.section : undefined}>
                    {isPlatformAdmin ? (
                      <div style={{ marginBottom: 10 }}>
                        <strong>{group.name}</strong>
                        {group.organization && !group.organization.active ? (
                          <span style={{ ...styles.small, marginLeft: 8 }}>inactive</span>
                        ) : null}
                      </div>
                    ) : null}

                    {group.users.map((u) => (
                  <div key={u.id} style={{ ...styles.section, background: "#fff" }}>
                    <div style={{ ...styles.row, marginBottom: 10 }}>
                      <input
                        style={styles.input}
                        placeholder="Username"
                        value={pendingUserForms[u.id]?.username || ""}
                        onChange={(e) =>
                          setPendingUserForms((prev) => ({
                            ...prev,
                            [u.id]: {
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
                              username: prev[u.id]?.username || u.username,
                              name: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    Status: waiting for admin approval. The user's registration password will be kept.
                    <div style={{ ...styles.row, marginTop: 10 }}>
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
                    ))}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ ...styles.row, marginBottom: 14 }}>
              {isPlatformAdmin ? (
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

            {approvedUsers.length === 0 ? (
              <div style={styles.small}>No users found.</div>
            ) : (
              (isPlatformAdmin ? approvedUserGroups : [{ key: "current", name: "", users: approvedUsers }]).map((group) => (
                <div key={group.key} style={isPlatformAdmin ? styles.section : undefined}>
                  {isPlatformAdmin ? (
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

                  {group.users.map((u) => (
                <div key={u.id} style={{ ...styles.section, background: "#fff" }}>
                  {editingUserId === u.id ? (
                    <>
                      <div style={{ ...styles.row, marginBottom: 10 }}>
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
                      <strong>{u.name}</strong> ({u.username}) - {u.role}
                      <br />
                      <div style={{ ...styles.row, marginTop: 10 }}>
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
                    </>
                  )}
                </div>
                  ))}
                </div>
              ))
            )}
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
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "block", marginTop: 8, marginBottom: 8 }}
                              onChange={(e) => {
                                handleWalkthroughPhotos(sectionIndex, itemIndex, e.target.files);
                                e.currentTarget.value = "";
                              }}
                            />
                            {walkthroughUploadingKey === uploadKey ? (
                              <div style={{ marginTop: 8, color: "#0f766e", fontSize: 13 }}>
                                Uploading photos...
                              </div>
                            ) : null}
                            <DesktopFilePicker
                              kind="image"
                              onSelect={(file) =>
                                handleWalkthroughDesktopPhoto(sectionIndex, itemIndex, file.path)
                              }
                            />
                          </div>

                          {(item.photos || []).length > 0 ? (
                            <div style={styles.photoGrid}>
                              {(item.photos || []).map((photo, photoIndex) => {
                                const src = photo.startsWith("http") ? photo : `${FILE_BASE}${photo}`;

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
                  walkthroughs.map((walkthrough) => (
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
                  ))
                )}
              </div>
            </div>
          ) : null}

          {activeAdminPage === "reports" ? (
          <div style={styles.section}>
            <h3 style={styles.title}>Completed Reports</h3>

            <div style={{ ...styles.section, background: "#fff" }}>
              <h3 style={styles.title}>Walkthrough Reports</h3>
              {walkthroughs.filter((walkthrough) => walkthrough.status === "completed").length === 0 ? (
                <div style={styles.small}>No completed walkthrough reports yet.</div>
              ) : (
                walkthroughs
                  .filter((walkthrough) => walkthrough.status === "completed")
                  .map((walkthrough) => (
                    <div key={walkthrough.id} style={styles.section}>
                      <strong>{walkthrough.title}</strong>
                      {walkthrough.location ? <> - {walkthrough.location}</> : null}
                      <br />
                      Created By: {walkthrough.createdByName || "-"}
                      <br />
                      {walkthrough.organizationName ? <>Organization: {walkthrough.organizationName}<br /></> : null}
                      Sections: {walkthrough.sections.length}
                      <br />
                      Comments: {walkthrough.sections.reduce((total, section) => total + section.items.length, 0)}
                      <div style={{ ...styles.row, marginTop: 10 }}>
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
                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={() => handleDeleteWalkthrough(walkthrough.id)}
                        >
                          Delete Walkthrough
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {reports.length === 0 ? (
              <div style={styles.small}>No reports yet.</div>
            ) : (
              reports.map((r) => (
                <div key={r.id} style={styles.section}>
                  <strong>{r.checklistTitle}</strong>
                  <br />
                  Completed By: {r.completedByName}
                  <br />
                  Assigned To: {r.assignedToName}
                  <br />
                  Status: {r.status}
                  <br />
                  <div style={{ ...styles.row, marginTop: 10 }}>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => setSelectedReport(r)}
                    >
                      View Detail
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

                    <a
                      style={{ ...styles.button, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                      href={getActionPlanExcelDownloadUrl(r.id)}
                    >
                      AI Action Plan Excel
                    </a>

                    <button
                      style={styles.button}
                      onClick={() => handleDownloadManagerSummary(r)}
                      disabled={managerSummaryReportId === r.id}
                    >
                      {managerSummaryReportId === r.id ? "Preparing Summary..." : "Manager Summary"}
                    </button>

                    <button
                      style={styles.button}
                      onClick={() => handleDeleteReport(r.id)}
                    >
                      Delete Report
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          ) : null}
        </>
      )}
    </DashboardShell>
  );
}
