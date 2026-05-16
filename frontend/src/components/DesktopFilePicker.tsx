import { useEffect, useState } from "react";
import { getLocalFiles, LocalFile, LocalFileKind } from "../services/api";
import { styles } from "../styles/appStyles";

type Props = {
  kind: LocalFileKind;
  onSelect: (file: LocalFile) => Promise<void> | void;
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DesktopFilePicker({ kind, onSelect }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectingPath, setSelectingPath] = useState("");

  const loadFiles = async () => {
    try {
      setLoading(true);
      setError("");
      setFiles(await getLocalFiles(kind));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Desktop files could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadFiles();
  }, [isOpen, kind]);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        style={styles.secondaryButton}
        onClick={() => setIsOpen((value) => !value)}
      >
        Browse Desktop Files
      </button>

      {isOpen ? (
        <div style={{ ...styles.section, background: "#fff", marginTop: 10 }}>
          <div style={{ ...styles.row, justifyContent: "space-between" }}>
            <strong>{kind === "image" ? "Images" : "Excel / CSV Files"}</strong>
            <button type="button" style={styles.secondaryButton} onClick={loadFiles}>
              Refresh
            </button>
          </div>

          {loading ? <div style={{ ...styles.small, marginTop: 10 }}>Loading files...</div> : null}
          {error ? <div style={{ ...styles.error, marginTop: 10 }}>{error}</div> : null}

          {!loading && files.length === 0 ? (
            <div style={{ ...styles.small, marginTop: 10 }}>
              No matching files found in Desktop, Downloads, Documents, or Pictures.
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                disabled={Boolean(selectingPath)}
                style={{
                  ...styles.secondaryButton,
                  textAlign: "left",
                  opacity: selectingPath && selectingPath !== file.path ? 0.55 : 1,
                }}
                onClick={async () => {
                  try {
                    setSelectingPath(file.path);
                    setError("");
                    await onSelect(file);
                    setIsOpen(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "File could not be selected");
                  } finally {
                    setSelectingPath("");
                  }
                }}
              >
                <span style={{ display: "block", fontWeight: 800 }}>{file.name}</span>
                <span style={{ display: "block", marginTop: 4, fontSize: 12 }}>
                  {file.folder} · {formatSize(file.size)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
