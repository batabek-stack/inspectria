import React, { useEffect, useState } from "react";
import { Report, Walkthrough } from "../types";
import { getArchivedReports } from "../services/reportService";
import { getArchivedWalkthroughs } from "../services/walkthroughService";
import { styles } from "../styles/appStyles";

const PAGE_SIZE = 20;

export default function ReportArchive({ onReport, onWalkthrough }: {
  onReport: (report: Report) => void;
  onWalkthrough: (walkthrough: Walkthrough) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("checklist");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<(Report | Walkthrough)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setRows([]);
    const request = kind === "checklist"
      ? getArchivedReports(offset, PAGE_SIZE + 1)
      : getArchivedWalkthroughs(offset, PAGE_SIZE + 1);
    request.then((result) => {
      if (!cancelled) setRows(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Archive could not be loaded.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, kind, offset, retry]);

  return (
    <div style={styles.section}>
      <p style={styles.small}>
        Active lists show the last 90 days. Older completed reports and their photos are kept in the archive.
      </p>
      <button type="button" style={styles.secondaryButton} aria-expanded={open}
        onClick={() => setOpen(!open)}>
        {open ? "Close Archive" : "Open Archive (older than 90 days)"}
      </button>
      {open && <div style={{ marginTop: 12 }}>
        <label>
          Report type{" "}
          <select value={kind} onChange={(event) => { setKind(event.target.value); setOffset(0); }}>
            <option value="checklist">Checklist reports</option>
            <option value="walkthrough">Walkthrough reports</option>
          </select>
        </label>
        {loading ? <p role="status">Loading archive...</p> : error ? <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry(retry + 1)}>Retry</button>
        </div> : <>
          {rows.length === 0 && <p>No archived reports.</p>}
          {rows.slice(0, PAGE_SIZE).map((row) => <div key={row.id} style={styles.section}>
            <strong>{"checklistTitle" in row ? row.checklistTitle : row.title}</strong>
            <p style={styles.small}>
              {row.completed_at ? new Date(row.completed_at).toLocaleDateString() : ""}
            </p>
            <button type="button" style={styles.secondaryButton} onClick={() => {
              if ("checklistTitle" in row) onReport(row);
              else onWalkthrough(row);
            }}>View Report</button>
          </div>)}
          <div style={styles.row}>
            <button type="button" style={styles.secondaryButton} disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
            <button type="button" style={styles.secondaryButton} disabled={rows.length <= PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </div>
        </>}
      </div>}
    </div>
  );
}
