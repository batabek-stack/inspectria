export type GeneratedDownload = {
  fileName: string;
  url: string;
  label: string;
  preview?: boolean;
};

export function createDownload(blob: Blob, fileName: string, label: string): GeneratedDownload {
  return {
    fileName,
    label,
    url: URL.createObjectURL(blob),
  };
}

export function createDownloadFromUrl(
  url: string,
  fileName: string,
  label: string,
  preview = false
): GeneratedDownload {
  return {
    fileName,
    label,
    url,
    preview,
  };
}

export function triggerDownload(download: GeneratedDownload) {
  const link = document.createElement("a");
  link.href = download.url;
  link.download = download.fileName;
  link.target = "_blank";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function openDownload(download: GeneratedDownload) {
  if (download.preview) {
    window.open(download.url, "_blank", "noopener");
    return;
  }

  triggerDownload(download);
}

export function revokeDownload(download: GeneratedDownload | null) {
  if (download && download.url.startsWith("blob:")) URL.revokeObjectURL(download.url);
}
