import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AnswerType,
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
import ReportDetail from "../components/ReportDetail";
import WalkthroughDetail from "../components/WalkthroughDetail";
import { getAssignments, startTemplate } from "../services/assignmentService";
import { getChecklists } from "../services/checklistService";
import {
  apiPost,
  createServerDownload,
  FILE_BASE,
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
import { emailReport } from "../services/emailService";
import {
  generateManagerSummary,
  getActionPlanExcelDownloadUrl,
  getReportFailedItems,
} from "../services/aiActionPlanService";
import { generateChecklistPdf } from "../utils/generateChecklistPdf";
import {
  createDownloadFromUrl,
  GeneratedDownload,
  openDownload,
  revokeDownload,
} from "../utils/downloadFile";
import { getMessages, markMessageRead } from "../services/messageService";

const AUTO_LOGOFF_SAVE_EVENT = "inspectria:auto-logoff-save";

type FillItem = {
  itemId: number;
  sectionTitle?: string;
  question: string;
  answerType: AnswerType;
  options?: string[];
  answer: string;
  comment: string;
  photos: string[];
};

type Props = {
  user: User;
  onLogout: () => Promise<void>;
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

export default function UserPage({ user, onLogout }: Props) {
  const localDraftKey = `mod_draft_${user.id}`;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [walkthroughs, setWalkthroughs] = useState<Walkthrough[]>([]);
  const [activeAssignmentId, setActiveAssignmentId] = useState<number | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<Walkthrough | null>(null);
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
  const [walkthroughTitle, setWalkthroughTitle] = useState("");
  const [walkthroughLocation, setWalkthroughLocation] = useState("");
  const [walkthroughSections, setWalkthroughSections] = useState<WalkthroughSection[]>([
    { title: "General", items: [{ comment: "", severity: "", photos: [] }] },
  ]);
  const [editingWalkthroughId, setEditingWalkthroughId] = useState<number | null>(null);
  const [walkthroughUploadingKey, setWalkthroughUploadingKey] = useState<string | null>(null);
  const activeAssignmentIdRef = useRef<number | null>(null);
  const latestFormRef = useRef<Record<number, FillItem>>({});
  const saveTimeoutRef = useRef<number | null>(null);

  const load = async () => {
    const [a, c, r, w, inbox] = await Promise.all([
      getAssignments(),
      getChecklists(),
      getReports(),
      getWalkthroughs(),
      getMessages(),
    ]);
    setAssignments(a);
    setChecklists(c);
    setMessages(inbox.messages);
    setReports(r);
    setWalkthroughs(w);
  };

  useEffect(() => {
    load();
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

  useEffect(() => {
    if (!activeChecklist) {
      setActiveSectionIndex(0);
      return;
    }

    setActiveSectionIndex((currentIndex) =>
      Math.min(currentIndex, Math.max(activeChecklist.sections.length - 1, 0))
    );
  }, [activeChecklist]);

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
        setMessage("Offline saved draft loaded.");
      }
    } finally {
      setForm(merged);
      latestFormRef.current = merged;
      writeLocalDraft(assignment.id, merged);
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

  const updateAnswer = (itemId: number, answer: string) => {
    setForm((prev) => {
      const nextForm = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          answer,
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
    const failedItems = getReportFailedItems(report);

    if (failedItems.length === 0) {
      alert("This report has no negative YES/NO items to summarize.");
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

  const handleEmailReport = async (report: Report) => {
    const to = window.prompt("Send report to which email address?");
    if (!to) return;

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
      alert(err instanceof Error ? err.message : "Report email could not be sent.");
    }
  };

  const handleEmailWalkthrough = async (walkthrough: Walkthrough) => {
    const to = window.prompt("Send walkthrough report to which email address?");
    if (!to) return;

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
      alert(err instanceof Error ? err.message : "Walkthrough email could not be sent.");
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

  const activeSection = activeChecklist?.sections[activeSectionIndex] || null;
  const sectionCount = activeChecklist?.sections.length || 0;
  const isFirstSection = activeSectionIndex === 0;
  const isLastSection = activeSectionIndex >= sectionCount - 1;
  const activeAssignments = assignments.filter((assignment) => assignment.status === "assigned");
  const adminAssignedAssignments = activeAssignments.filter(
    (assignment) => !assignment.isSelfStarted
  );
  const selfStartedChecklistIds = new Set(
    activeAssignments
      .filter((assignment) => assignment.isSelfStarted)
      .map((assignment) => assignment.checklist_id)
  );

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

  return (
    <DashboardShell user={user} onLogout={onLogout}>
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
        <>
          <div style={styles.section}>
            <h3 style={styles.title}>My Assignments</h3>

            {adminAssignedAssignments.length === 0 ? (
              <div style={styles.small}>No active assignments.</div>
            ) : (
              adminAssignedAssignments
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
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>Available Templates</h3>
            <div style={styles.small}>
              Choose any template created for your organization and complete it without waiting for an assignment.
            </div>

            {checklists.length === 0 ? (
              <div style={{ ...styles.small, marginTop: 12 }}>No templates are available for your organization.</div>
            ) : (
              checklists.map((checklist) => {
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
                  </div>
                );
              })
            )}
          </div>

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

                        <div className="walkthrough-comment-actions" style={{ ...styles.row, marginTop: 10 }}>
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
              walkthroughs.map((walkthrough) => (
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
              ))
            )}
          </div>

          <div style={styles.section}>
            <h3 style={styles.title}>My Reports</h3>

            {reports.length === 0 ? (
              <div style={styles.small}>No reports yet.</div>
            ) : (
              reports.map((r) => (
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
              ))
            )}
          </div>
        </>
      ) : (
        <div style={styles.section}>
          {(activeChecklist.image_path || activeChecklist.imagePath) ? (
            <img
              src={(activeChecklist.image_path || activeChecklist.imagePath || "").startsWith("http") ? (activeChecklist.image_path || activeChecklist.imagePath) : `${FILE_BASE}${activeChecklist.image_path || activeChecklist.imagePath}`}
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
                <div key={item.id} style={{ ...styles.section, background: "#fff" }}>
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
                        const src = photo.startsWith("http")
                          ? photo
                          : `${FILE_BASE}${photo}`;

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
