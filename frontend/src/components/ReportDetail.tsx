import React from "react";
import { FILE_BASE } from "../services/api";
import { styles } from "../styles/appStyles";
import { AnswerType } from "../types";

type ReportItem = {
  id?: number | string;
  question: string;
  answer: string;
  answerType?: AnswerType;
  answer_type?: AnswerType;
  comment: string;
  photos: string[];
  sectionTitle?: string;
  section_title?: string;
};

type Report = {
  id: number | string;
  checklistTitle: string;
  checklistImagePath?: string;
  completedByName: string;
  assignedToName: string;
  assignedByName: string;
  completed_at?: string;
  completedAt?: string;
  status: string;
  items: ReportItem[];
};

type Props = {
  report: Report;
  onBack?: () => void;
  onDownloadPdf?: (report: Report) => void;
  onEmailReport?: (report: Report) => void;
  onDeleteReport?: (report: Report) => void;
  onDownloadActionPlan?: (report: Report) => void;
  onDownloadManagerSummary?: (report: Report) => void;
  actionPlanLoading?: boolean;
  managerSummaryLoading?: boolean;
};

function formatDate(value?: string) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("en-US");
  } catch {
    return value;
  }
}

function answerStyle(answer: string): React.CSSProperties {
  if (answer === "YES") {
    return {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: 999,
      background: "#dcfce7",
      color: "#166534",
      fontWeight: 700,
    };
  }

  if (answer === "NO") {
    return {
      display: "inline-block",
      padding: "4px 10px",
      borderRadius: 999,
      background: "#fee2e2",
      color: "#991b1b",
      fontWeight: 700,
    };
  }

  return {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#ccfbf1",
    color: "#0f766e",
    fontWeight: 700,
  };
}

export default function ReportDetail({
  report,
  onBack,
  onDownloadPdf,
  onEmailReport,
  onDeleteReport,
  onDownloadActionPlan,
  onDownloadManagerSummary,
  actionPlanLoading = false,
  managerSummaryLoading = false,
}: Props) {
  const scoredItems = report.items.filter(
    (item) => (item.answerType || item.answer_type || "FORMAT1") === "FORMAT1"
  );
  const totalQuestions = scoredItems.length;
  const yesCount = scoredItems.filter((item) => item.answer === "YES").length;
  const noItems = scoredItems.filter((item) => item.answer === "NO");
  const successRate = totalQuestions > 0 ? Math.round((yesCount / totalQuestions) * 100) : 0;

  return (
    <div>
      <div
        className="responsive-report-top"
        style={{ ...styles.row, justifyContent: "space-between", marginBottom: 14 }}
      >
        <div>
          {report.checklistImagePath ? (
            <img
              src={report.checklistImagePath.startsWith("http") ? report.checklistImagePath : `${FILE_BASE}${report.checklistImagePath}`}
              alt={report.checklistTitle}
              style={{
                width: "25%",
                minWidth: 120,
                maxWidth: 220,
                height: "auto",
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid #d7e6e4",
                marginBottom: 10,
                display: "block",
              }}
            />
          ) : null}
          <h2 style={{ margin: 0 }}>{report.checklistTitle}</h2>
        </div>
        <div className="responsive-report-actions" style={{ ...styles.row }}>
          {onBack ? (
            <button type="button" style={styles.secondaryButton} onClick={onBack}>
              Back
            </button>
          ) : null}
          {onDownloadPdf ? (
            <button type="button" style={styles.button} onClick={() => onDownloadPdf(report)}>
              Download PDF
            </button>
          ) : null}
          {onEmailReport ? (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => onEmailReport(report)}
            >
              Email Report
            </button>
          ) : null}
          {onDeleteReport ? (
            <button type="button" style={styles.secondaryButton} onClick={() => onDeleteReport(report)}>
              Delete Report
            </button>
          ) : null}
          {onDownloadActionPlan ? (
            <button
              type="button"
              style={styles.button}
              onClick={() => onDownloadActionPlan(report)}
              disabled={actionPlanLoading}
            >
              {actionPlanLoading ? "Preparing Excel..." : "AI Action Plan Excel"}
            </button>
          ) : null}
          {onDownloadManagerSummary ? (
            <button
              type="button"
              style={styles.button}
              onClick={() => onDownloadManagerSummary(report)}
              disabled={managerSummaryLoading}
            >
              {managerSummaryLoading ? "Preparing Summary..." : "Manager Summary"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, #ccfbf1, #99f6e4)",
          border: "2px solid #0f766e",
          borderRadius: 16,
          padding: 18,
          marginBottom: 18,
          textAlign: "center",
          boxShadow: "0 4px 12px rgba(15,118,110,0.16)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f766e", letterSpacing: 0.5 }}>
          Success Rate
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#06323f", marginTop: 6 }}>
          %{successRate}
        </div>
        <div style={{ marginTop: 4, color: "#334155", fontSize: 13 }}>
          {yesCount} / {totalQuestions} questions passed
        </div>
      </div>

      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <strong>Completed By:</strong> {report.completedByName}
        </div>
        <div>
          <strong>Assigned To:</strong> {report.assignedToName}
        </div>
        <div>
          <strong>Assigned By:</strong> {report.assignedByName}
        </div>
        <div>
          <strong>Completed At:</strong> {formatDate(report.completed_at || report.completedAt)}
        </div>
        <div>
          <strong>Status:</strong> {report.status}
        </div>
      </div>

      <div
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#991b1b", marginBottom: 10 }}>
          Items Marked No
        </div>

        {noItems.length === 0 ? (
          <div style={{ color: "#166534", fontWeight: 600 }}>No items were marked No.</div>
        ) : (
          noItems.map((item, index) => (
            <div
              key={item.id || index}
              style={{
                padding: "10px 0",
                borderBottom: index === noItems.length - 1 ? "none" : "1px solid #fecaca",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {index + 1}. {item.question}
              </div>
              <div style={{ marginTop: 4 }}>Comment: {item.comment || "-"}</div>
            </div>
          ))
        )}
      </div>

      <div>
        {report.items.map((item, index) => (
          <div
            key={item.id || index}
            style={{
              border: "1px solid #d7e6e4",
              borderRadius: 14,
              padding: 16,
              marginBottom: 14,
              background: "#fff",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
              {index + 1}. {item.question}
            </div>

            <div style={{ marginBottom: 8 }}>
              <span style={answerStyle(item.answer)}>{item.answer || "-"}</span>
            </div>

            <div style={{ marginBottom: 10 }}>
              <strong>Comment:</strong> {item.comment || "-"}
            </div>

            {item.photos?.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 12,
                  marginTop: 10,
                }}
              >
                {item.photos.map((photo, photoIndex) => {
                  const src = photo.startsWith("http") ? photo : `${FILE_BASE}${photo}`;
                  return (
                    <img
                      key={photoIndex}
                      src={src}
                      alt={`report-${photoIndex}`}
                      style={{
                        width: "100%",
                        height: 120,
                        objectFit: "cover",
                        borderRadius: 10,
                        border: "1px solid #d7e6e4",
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
