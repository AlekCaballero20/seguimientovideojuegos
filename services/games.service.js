import { upsertItem, removeItem } from "../firebase/firestore.service.js";
import { CATEGORY_META } from "../utils/constants.js";

export function normalizeGame(input = {}) {
  const category = CATEGORY_META[input.category] ? input.category : "secondary";
  return {
    id: input.id || crypto.randomUUID(),
    title: String(input.title || "").trim() || "Juego sin nombre",
    consoleId: input.consoleId || "",
    category,
    rotationEnabled: input.rotationEnabled !== false,
    allowInRotation: category === "secondary" ? Boolean(input.allowInRotation) : category === "main",
    progress: Number.isFinite(Number(input.progress)) ? Math.max(0, Math.min(100, Number(input.progress))) : 0,
    estimatedMinutes: Number.isFinite(Number(input.estimatedMinutes)) ? Math.max(10, Number(input.estimatedMinutes)) : 60,
    priority: Number.isFinite(Number(input.priority)) ? Math.max(1, Math.min(5, Number(input.priority))) : 3,
    genre: String(input.genre || "").trim(),
    moodTags: Array.isArray(input.moodTags) ? input.moodTags : String(input.moodTags || "").split(",").map((x) => x.trim()).filter(Boolean),
    notes: String(input.notes || "").trim(),
    addedAt: input.addedAt || Date.now(),
    startedAt: input.startedAt || null,
    lastPlayed: input.lastPlayed || null,
    completedAt: input.completedAt || null,
    totalMinutes: Number(input.totalMinutes) || 0,
    sessionsCount: Number(input.sessionsCount) || 0,
    ratingSum: Number(input.ratingSum) || 0
  };
}

export function mainGamesForConsole(games, consoleId, excludingId = null) {
  return games.filter((game) => game.consoleId === consoleId && game.category === "main" && game.id !== excludingId);
}

export async function saveGame(uid, games, rawGame, options = {}) {
  const game = normalizeGame(rawGame);
  const existingMain = mainGamesForConsole(games, game.consoleId, game.id);
  if (game.category === "main" && existingMain.length >= 2 && !options.demoteGameId) {
    const error = new Error("MAIN_LIMIT_REACHED");
    error.code = "MAIN_LIMIT_REACHED";
    error.existingMain = existingMain;
    throw error;
  }

  if (game.category === "main" && options.demoteGameId) {
    const demote = games.find((g) => g.id === options.demoteGameId);
    if (demote) await upsertItem(uid, "games", { ...demote, category: "secondary", allowInRotation: true });
  }

  return upsertItem(uid, "games", game);
}

export async function updateGame(uid, game) {
  return upsertItem(uid, "games", normalizeGame(game));
}

export async function deleteGame(uid, gameId) {
  return removeItem(uid, "games", gameId);
}

export function gameAverageRating(game) {
  if (!game.sessionsCount || !game.ratingSum) return 0;
  return game.ratingSum / game.sessionsCount;
}
