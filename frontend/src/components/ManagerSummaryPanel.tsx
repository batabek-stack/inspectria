import { useEffect, useRef } from "react";
import { ManagerSummaryResponse, Report } from "../types";
import { styles } from "../styles/appStyles";

type Props = {
  report: Report;
  summary: ManagerSummaryResponse;
  onClose: () => void;
};

export default function ManagerSummaryPanel({ report, summary, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const paragraphs = summary.summaryText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [report.id, summary.summaryTitle, summary.summaryText]);

  return (
    <div
      ref={panelRef}
      className="manager-summary-print-area"
      style={{ ...styles.section, background: "#ffffff", borderColor: "#0f766e", scrollMarginTop: 16 }}
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
      {paragraphs.map((paragraph) => (
        <p key={paragraph} style={{ marginTop: 0 }}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}
