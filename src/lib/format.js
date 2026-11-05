export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "Nov 5" (or "Nov 5, 2025" for another year): for tight spaces. */
export function formatShortDate(ms) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** File name without ".pdf", shortened to `max` characters for tabs and labels. */
export function shortName(name, max = 28) {
  const base = String(name || "").replace(/\.pdf$/i, "");
  return base.length > max ? `${base.slice(0, max - 2)}…` : base;
}
