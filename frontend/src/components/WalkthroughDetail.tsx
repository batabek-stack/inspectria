import React from "react";
import { Walkthrough } from "../types";
import { styles } from "../styles/appStyles";
import { FILE_BASE } from "../services/api";

type Props = {
  walkthrough: Walkthrough;
  onBack: () => void;
  onEmailReport?: (walkthrough: Walkthrough) => void;
  onDeleteReport?: (walkthrough: Walkthrough) => void;
};

export default function WalkthroughDetail({
  walkthrough,
  onBack,
  onEmailReport,
  onDeleteReport,
}: Props) {
  const completedAt = walkthrough.completed_at || walkthrough.updated_at;

  return (
    <div>
      <div
        className="responsive-report-top"
        style={{ ...styles.row, justifyContent: "space-between", marginBottom: 14 }}
      >
        <button type="button" style={styles.secondaryButton} onClick={onBack}>
          Back
        </button>
        {onEmailReport ? (
          <button type="button" style={styles.button} onClick={() => onEmailReport(walkthrough)}>
            Email Report
          </button>
        ) : null}
        {onDeleteReport ? (
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => onDeleteReport(walkthrough)}
          >
            Delete Walkthrough
          </button>
        ) : null}
      </div>

      <div style={styles.section}>
        <h2 style={styles.title}>{walkthrough.title}</h2>
        {walkthrough.location ? <div>Location: {walkthrough.location}</div> : null}
        <div>Status: {walkthrough.status}</div>
        {walkthrough.createdByName ? <div>Created By: {walkthrough.createdByName}</div> : null}
        {walkthrough.organizationName ? <div>Organization: {walkthrough.organizationName}</div> : null}
        <div>Completed At: {completedAt ? new Date(completedAt).toLocaleString() : "-"}</div>
      </div>

      {walkthrough.sections.map((section, sectionIndex) => (
        <div key={section.id || sectionIndex} style={styles.section}>
          <h3 style={styles.title}>{sectionIndex + 1}. {section.title}</h3>

          {section.items.length === 0 ? (
            <div style={styles.small}>No comments in this section.</div>
          ) : (
            section.items.map((item, itemIndex) => (
              <div key={item.id || itemIndex} style={{ ...styles.section, background: "#fff" }}>
                <strong>Comment {itemIndex + 1}</strong>
                {item.severity ? <span style={{ marginLeft: 8 }}>Severity: {item.severity}</span> : null}
                <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.comment || "-"}</p>

                {item.photos?.length ? (
                  <div style={styles.photoGrid}>
                    {item.photos.map((photo, photoIndex) => {
                      const src = photo.startsWith("http") ? photo : `${FILE_BASE}${photo}`;

                      return (
                        <div key={photoIndex} style={styles.photoCard}>
                          <img
                            src={src}
                            alt={`walkthrough-${sectionIndex}-${itemIndex}-${photoIndex}`}
                            style={styles.photoPreview}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
