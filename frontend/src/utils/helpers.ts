export function formatDate(value?: string | Date) {
  if (!value) return "-";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("tr-TR");
  } catch {
    return "-";
  }
}

export function safeText(value?: string | null) {
  return value && value.trim() ? value.trim() : "-";
}
