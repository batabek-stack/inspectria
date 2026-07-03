const FALLBACK_HOST = "localhost:4000";

const browserOrigin =
  typeof window !== "undefined" ? window.location.origin : `http://${FALLBACK_HOST}`;
const isViteDevServer =
  typeof window !== "undefined" && window.location.port === "5173";
const viteEnv =
  typeof import.meta !== "undefined"
    ? ((import.meta as { env?: Record<string, string | undefined> }).env ?? {})
    : {};

const configuredApiBase =
  viteEnv.VITE_API_BASE ? String(viteEnv.VITE_API_BASE) : "";

const configuredFileBase =
  viteEnv.VITE_FILE_BASE ? String(viteEnv.VITE_FILE_BASE) : "";

function getApiHostBase(apiBase: string) {
  return apiBase.replace(/\/api\/?$/, "");
}

export const API_BASE = configuredApiBase
  ? configuredApiBase
  : isViteDevServer
    ? `http://${FALLBACK_HOST}/api`
    : `${browserOrigin}/api`;

export const FILE_BASE = configuredFileBase
  ? configuredFileBase
  : configuredApiBase
    ? getApiHostBase(configuredApiBase)
  : isViteDevServer
    ? `http://${FALLBACK_HOST}`
    : browserOrigin;

export function resolveFileUrl(pathOrUrl: string): string {
  const value = String(pathOrUrl || "").trim();
  if (!value) return "";

  if (/^(https?:|data:|blob:)/i.test(value)) return value;

  const base = FILE_BASE.replace(/\/+$/, "");
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${base}${path}`;
}

function authHeaders() {
  const token = localStorage.getItem("mod_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `GET ${path} failed`);
  }

  return data as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `POST ${path} failed`);
  }

  return data as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `PUT ${path} failed`);
  }

  return data as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `DELETE ${path} failed`);
  }

  return data as T;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = String(reader.result || "");
      resolve(value.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function createServerDownload(
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<{ url: string; fileName: string }> {
  const base64 = await blobToBase64(blob);
  const payload = {
    fileName,
    mimeType,
    base64,
  };

  try {
    return await apiPost<{ url: string; fileName: string }>("/downloads", payload);
  } catch {
    const candidates = [`${FILE_BASE}/api/downloads`, `${FILE_BASE}/downloads`];
    let lastError: unknown;

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data as { url: string; fileName: string };
        lastError = new Error((data as { message?: string }).message || `POST ${url} failed`);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Download could not be prepared");
  }
}

export async function uploadPhotos(files: FileList | null): Promise<string[]> {
  if (!files || files.length === 0) return [];

  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("photos", file));

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || "Photo upload failed");
  }

  return ((data as { files?: string[] }).files || []);
}

export type LocalFileKind = "image" | "spreadsheet";

export type LocalFile = {
  name: string;
  path: string;
  folder: string;
  kind: LocalFileKind;
  size: number;
  modifiedAt: string;
};

export async function getLocalFiles(kind: LocalFileKind): Promise<LocalFile[]> {
  const query = new URLSearchParams({ kind });
  const res = await fetch(`${API_BASE}/local-files?${query.toString()}`, {
    headers: {
      ...authHeaders(),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || "Local files could not be listed");
  }

  return (data as { files?: LocalFile[] }).files || [];
}

export async function copyLocalImageToUploads(path: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/local-files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ path }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as { message?: string }).message || "Local image could not be copied");
  }

  return (data as { files?: string[] }).files || [];
}

export async function getLocalFileBlob(path: string): Promise<Blob> {
  const query = new URLSearchParams({ path });
  const res = await fetch(`${API_BASE}/local-files/file?${query.toString()}`, {
    headers: {
      ...authHeaders(),
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || "Local file could not be opened");
  }

  return res.blob();
}
