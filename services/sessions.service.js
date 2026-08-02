import { upsertItem } from "../firebase/firestore.service.js";
import { normalizeGame } from "./games.service.js";
import { todayISO } from "../utils/dates.js";

export async function registerSession(uid, game, sessionInput = {}) {
  const now = Date.now();
  const duration = Math.max(1, Number(sessionInput.duration) || 30);
  const rating = Number(sessionInput.rating) || 0;
  const totalMinutes = (Number(game.totalMinutes) || 0) + duration;
  const estimate = Math.max(10, Number(game.estimatedMinutes) || 60);
  const progress = Math.min(100, (totalMinutes / estimate) * 100);
  const completed = Boolean(sessionInput.completed) || progress >= 100;

  const session = {
    id: crypto.randomUUID(),
    gameId: game.id,
    consoleId: game.consoleId,
    categoryAtPlay: game.category,
    playedAt: now,
    date: todayISO(),
    duration,
    rating: rating > 0 ? Math.max(1, Math.min(5, rating)) : null,
    mood: String(sessionInput.mood || "").trim(),
    note: String(sessionInput.note || "").trim(),
    progress
  };

  const updatedGame = normalizeGame({
    ...game,
    progress,
    startedAt: game.startedAt || now,
    lastPlayed: now,
    completedAt: completed ? (game.completedAt || now) : game.completedAt,
    category: completed ? "completed" : game.category,
    allowInRotation: completed ? false : game.allowInRotation,
    totalMinutes,
    sessionsCount: (Number(game.sessionsCount) || 0) + 1,
    ratingSum: (Number(game.ratingSum) || 0) + (session.rating || 0)
  });

  await upsertItem(uid, "sessions", session);
  await upsertItem(uid, "games", updatedGame);
  return session;
}
