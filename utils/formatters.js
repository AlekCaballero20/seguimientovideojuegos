import { CATEGORY_META } from "./constants.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function minutesLabel(minutes = 0) {
  const total = Number(minutes) || 0;
  if (total <= 0) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

export function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function categoryBadge(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META.secondary;
  return `<span class="badge ${meta.className}">${meta.icon} ${meta.label}</span>`;
}

export function stars(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return "Sin rating";
  return "★".repeat(Math.max(1, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result || "{}"))); }
      catch (error) { reject(error); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
