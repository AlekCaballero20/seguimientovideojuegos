export function todayISO() {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfDayMs(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysBetween(fromMs, toMs = Date.now()) {
  if (!fromMs) return null;
  return Math.max(0, Math.floor((startOfDayMs(toMs) - startOfDayMs(fromMs)) / 86400000));
}

export function humanDate(msOrIso) {
  if (!msOrIso) return "Sin fecha";
  const d = typeof msOrIso === "string" ? new Date(`${msOrIso}T12:00:00`) : new Date(msOrIso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export function relativeDay(ms) {
  if (!ms) return "Nunca";
  const diff = daysBetween(ms);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return `Hace ${diff} días`;
}
