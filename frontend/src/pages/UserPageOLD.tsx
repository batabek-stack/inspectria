import React, { useEffect, useMemo, useState } from "react";
import { Assignment, Checklist, Report, User } from "../types";
import { styles } from "../styles/appStyles";
import DashboardShell from "../components/DashboardShell";
import ReportDetail from "../components/ReportDetail";
import { getAssignments } from "../services/assignmentService";
import { getChecklists } from "../services/checklistService";
import { apiPost, uploadPhotos } from "../services/api";
import { getReports } from "../services/reportService";
import { generateChecklistPdf } from "../utils/generateChecklistPdf";

type FillItem = {
  itemId: number;
  question: string;
  answer: "YES" | "NO" | "N/A" | "";
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
    color: "#111827",
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
    background: "#2563eb",
    color: "#ffffff",
    border: "1px solid #2563eb",
  };
}

function mapReportToPdfPayload(report: Report) {
  return {
    hotelName: "Inspectria",
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
      comment: item.comment || "",
      photos: item.photos || [],
    })),
  };
}

export default function UserPage({ user, onLogout }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [activeAssignmentId, setActiveAssignmentId] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [form, setForm] = useState<Record<number, FillItem>>({});
  const [message, setMessage] = useState("");
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);

  const load = async () => {
    const [a, c, r] = await Promise.all([
      getAssignments(),
      getChecklists(),
      getReports(),
    ]);
    setAssignments(a);
    setChecklists(c);
    setReports(r);
  };

  useEffect(() => {
    load();
  }, []);

  const activeAssignment =
    assignments.find((a) => a.id === activeAssignmentId) || null;

  const activeChecklist = useMemo(() => {
    if (!activeAssignment) return null;
    return checklists.find((c) => c.id === activeAssignment.checklist_id) || null;
  }, [activeAssignment, checklists]);

  const openAssignment = (assignment: Assignment) => {
    const checklist = checklists.find((c) => c.id === assignment.checklist_id);
    if (!checklist) return;

    const initial: Record<number, FillItem> = {};
    checklist.items.forEach((item) => {
      initial[item.id] = {
        itemId: item.id,
        question: item.question,
        answer: "",
        comment: "",
        photos: [],
      };
    });

    setSelectedReport(null);
    setForm(initial);
    setActiveAssignmentId(assignment.id);
  };

  const handleAddPhotos = async (itemId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      setUploadingItemId(itemId);
      const uploaded = await uploadPhotos(files);

      setForm((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          photos: [...(prev[itemId]?.photos || []), ...uploaded],
        },
      }));
    } catch (error) {
      console.error(error);
      alert("Photo upload failed.");
    } finally {
      setUploadingItemId(null);
    }
  };

  const removePhoto = (itemId: number, photoIndex: number) => {
    setForm((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        photos: prev[itemId].photos.filter((_, idx) => idx !== photoIndex),
      },
    }));
  };

  const submit = async () => {
    if (!activeChecklist || !activeAssignment) return;

    const items = activeChecklist.items.map((item) => form[item.id]);

    await apiPost("/reports", {
      assignmentId: activeAssignment.id,
      items,
    });

    setMessage("Checklist completed.");
    setActiveAssignmentId(null);
    setForm({});
    await load();
  };

  const handleDownloadPdf = async (report: Report) => {
    const pdfPayload = mapReportToPdfPayload(report);
    await generateChecklistPdf(pdfPayload);
  };

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      {message ? (
        <div style={{ ...styles.section, background: "#ecfeff" }}>{message}</div>
      ) : null}

      {selectedReport ? (
        <ReportDetail
          report={selectedReport}
          onBack={() => setSelectedReport(null)}
          onDownloadPdf={handleDownloadPdf}
        />
      ) : !activeAssignment || !activeChecklist ? (
        <>
          <div style={styles.section}>
            <h3 style={styles.title}>My Assignments</h3>

            {assignments.filter((a) => a.status === "assigned").length === 0 ? (
              <div style={styles.small}>No active assignments.</div>
            ) : (
              assignments
                .filter((a) => a.status === "assigned")
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
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div style={styles.section}>
          <h3 style={styles.title}>{activeChecklist.title}</h3>

          {activeChecklist.items.map((item, index) => (
            <div key={item.id} style={styles.section}>
              <strong>
                {index + 1}. {item.question}
              </strong>

              <div style={{ ...styles.row, marginTop: 10 }}>
                {(["YES", "NO", "N/A"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    style={getAnswerButtonStyle(value, form[item.id]?.answer || "")}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        [item.id]: {
                          ...prev[item.id],
                          answer: value,
                        },
                      }))
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 10 }}>
                <textarea
                  style={{ ...styles.input, minHeight: 80 }}
                  placeholder="Comment"
                  value={form[item.id]?.comment || ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      [item.id]: {
                        ...prev[item.id],
                        comment: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
                  Add Photos
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleAddPhotos(item.id, e.target.files)}
                />
                {uploadingItemId === item.id ? (
                  <div style={{ marginTop: 8, color: "#2563eb", fontSize: 13 }}>
                    Uploading photos...
                  </div>
                ) : null}
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
                      : `http://localhost:4000${photo}`;

                    return (
                      <div
                        key={idx}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          padding: 10,
                          background: "#fafafa",
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

          <div style={styles.row}>
            <button
              style={styles.secondaryButton}
              onClick={() => setActiveAssignmentId(null)}
            >
              Cancel
            </button>
            <button style={styles.button} onClick={submit}>
              Complete Checklist
            </button>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
