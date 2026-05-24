import { upsertItem, removeItem } from "../firebase/firestore.service.js";
import { DEFAULT_CONSOLES } from "../utils/constants.js";

export async function ensureDefaultConsoles(uid, consoles) {
  if (consoles.length) return;
  await Promise.all(DEFAULT_CONSOLES.map((consoleItem) => upsertItem(uid, "consoles", {
    id: crypto.randomUUID(),
    ...consoleItem,
    createdAt: Date.now()
  })));
}

export async function saveConsole(uid, consoleItem) {
  const cleaned = {
    id: consoleItem.id || crypto.randomUUID(),
    name: String(consoleItem.name || "").trim() || "Consola sin nombre",
    icon: String(consoleItem.icon || "🎮").trim() || "🎮",
    color: consoleItem.color || "#55b6ff",
    weight: Math.max(0.2, Math.min(5, Number(consoleItem.weight) || 1))
  };
  return upsertItem(uid, "consoles", cleaned);
}

export async function deleteConsole(uid, consoleId) {
  return removeItem(uid, "consoles", consoleId);
}
