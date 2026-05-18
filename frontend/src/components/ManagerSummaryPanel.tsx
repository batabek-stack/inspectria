import { ManagerSummaryResponse, Report } from "../types";
import { getReportFailedItems } from "../services/aiActionPlanService";
import { styles } from "../styles/appStyles";

type Props = {
  report: Report;
  summary: ManagerSummaryResponse;
  onClose: () => void;
};

export default function ManagerSummaryPanel({ report, summary, onClose }: Props) {
  const noItems = getReportFailedItems(report);
  const paragraphs = summary.summaryText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div
      className="manager-summary-print-area"
      style={{ ...styles.section, background: "#ffffff", borderColor: "#0f766e" }}
    >
      <div
        className="manager-summary-actions"
        style={{ ...styles.row, justifyContent: "space-between", marginBottom: 12 }}
      >
        <h3 style={{ ...styles.title, margin: 0 }}>Manager Summary</h3>
        <div style={styles.row}>
          <button type="button" style={styles.button} onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <h4 style={{ margin: "0 0 8px" }}>{summary.summaryTitle}</h4>
      <div style={{ ...styles.small, marginBottom: 12 }}>
        {noItems.length} negative item{noItems.length === 1 ? "" : "s"} reviewed
      </div>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} style={{ marginTop: 0 }}>
          {paragraph}
        </p>
      ))}
      {noItems.length > 0 ? (
        <>
          <h4>Negative Items Reviewed</h4>
          {noItems.map((item, index) => (
            <div key={`${item.id || item.question}-${index}`} style={{ borderTop: "1px solid #d7e6e4", padding: "10px 0" }}>
              <strong>
                {index + 1}. {item.question}
              </strong>
              {item.comment ? <div>Comment: {item.comment}</div> : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
