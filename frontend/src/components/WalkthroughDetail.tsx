import React, { useMemo, useState } from "react";
import { Walkthrough } from "../types";
import { styles } from "../styles/appStyles";
import { API_BASE, FILE_BASE } from "../services/api";

type Props = {
  walkthrough: Walkthrough;
  onBack: () => void;
  onEmailReport?: (walkthrough: Walkthrough) => void;
  onDeleteReport?: (walkthrough: Walkthrough) => void;
};

function getPhotoSources(photo: string) {
  if (photo.startsWith("data:image/") || photo.startsWith("http")) return [photo];

  const serverPath = photo.startsWith("/") ? photo : `/${photo}`;
  const apiHostBase = API_BASE.replace(/\/api\/?$/, "");
  const browserBase = typeof window !== "undefined" ? window.location.origin : "";

  return Array.from(
    new Set(
      [
        `${FILE_BASE}${serverPath}`,
        `${apiHostBase}${serverPath}`,
        `${browserBase}${serverPath}`,
        serverPath,
      ].filter(Boolean)
    )
  );
}

function WalkthroughPhoto({ photo, alt }: { photo: string; alt: string }) {
  const sources = useMemo(() => getPhotoSources(photo), [photo]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const src = dataUrl || sources[sourceIndex] || "";

  const loadPhotoData = async () => {
    if (!photo || photo.startsWith("data:image/") || photo.startsWith("http")) {
      setFailed(true);
      return;
    }

    try {
      const serverPath = photo.startsWith("/") ? photo : `/${photo}`;
      const response = await fetch(
        `${API_BASE}/walkthroughs/photo-data?path=${encodeURIComponent(serverPath)}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("mod_token") || ""}`,
          },
        }
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:image/")) {
        setDataUrl(data.dataUrl);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  };

  if (!src || failed) return null;

  return (
    <img
      src={src}
      alt={alt}
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex((current) => current + 1);
          return;
        }

        void loadPhotoData();
      }}
      style={styles.photoPreview}
    />
  );
}

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
                    {item.photos.map((photo, photoIndex) => (
                      <div key={photoIndex} style={styles.photoCard}>
                        <WalkthroughPhoto
                          photo={photo}
                          alt={`walkthrough-${sectionIndex}-${itemIndex}-${photoIndex}`}
                        />
                      </div>
                    ))}
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
