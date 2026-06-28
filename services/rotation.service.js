import { daysBetween, todayISO } from "../utils/dates.js";
import { upsertItem } from "../firebase/firestore.service.js";

export function playableForRotation(data, options = {}) {
  const includeSecondary = options.includeSecondary !== false;
  const includeCuriosity = Boolean(options.includeCuriosity);
  const shortSession = Boolean(options.shortSession);

  return data.games.filter((game) => {
    if (!game.consoleId) return false;
    if (game.rotationEnabled === false) return false;
    if (game.category === "completed" || game.category === "paused" || game.category === "wishlist") return false;
    if (game.category === "main") return true;
    if (game.category === "secondary") return includeSecondary && game.allowInRotation !== false;
    if (game.category === "curiosity") return includeCuriosity;
    if (shortSession && Number(game.estimatedMinutes || 60) > 70) return false;
    return false;
  });
}

export function scoreGame(game, data, options = {}) {
  const consoleItem = data.consoles.find((c) => c.id === game.consoleId);
  const days = game.lastPlayed ? daysBetween(game.lastPlayed) : 60;
  const categoryBase = game.category === "main" ? 80 : game.category === "secondary" ? 35 : 16;
  const consoleWeight = Number(consoleItem?.weight) || 1;
  const priority = Number(game.priority) || 3;
  const ageBoost = Math.min(42, (days ?? 60) * 3.2);
  const progressBoost = Math.max(0, 18 - ((Number(game.progress) || 0) / 8));
  const estimatePenalty = options.shortSession && Number(game.estimatedMinutes || 60) > 55 ? -28 : 0;

  let recentPenalty = 0;
  if (options.avoidRecent) {
    const recent = data.sessions
      .slice()
      .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
      .slice(0, 4);
    if (recent.some((s) => s.gameId === game.id)) recentPenalty -= 38;
    if (recent.filter((s) => s.consoleId === game.consoleId).length >= 2) recentPenalty -= 16;
  }

  return Math.max(1, categoryBase + ageBoost + progressBoost + (consoleWeight * 10) + (priority * 5) + estimatePenalty + recentPenalty);
}

export function pickGame(data, options = {}) {
  let candidates = playableForRotation(data, options);
  if (!candidates.length) return null;

  if (!options.ignoreGenreRotation) {
    const lastSession = data.sessions.slice().sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))[0];
    const lastGame = lastSession ? data.games.find((game) => game.id === lastSession.gameId) : null;
    const lastGenre = String(lastGame?.genre || "").trim().toLocaleLowerCase();
    const otherGenres = lastGenre
      ? candidates.filter((game) => String(game.genre || "").trim().toLocaleLowerCase() !== lastGenre)
      : [];
    if (otherGenres.length) candidates = otherGenres;
  }

  const ranked = candidates.slice().sort((a, b) => {
    const neverPlayed = Number(!b.lastPlayed) - Number(!a.lastPlayed);
    if (neverPlayed) return neverPlayed;
    const oldestFirst = (a.lastPlayed || 0) - (b.lastPlayed || 0);
    if (oldestFirst) return oldestFirst;
    const scoreDifference = scoreGame(b, data, options) - scoreGame(a, data, options);
    if (scoreDifference) return scoreDifference;
    return String(a.title).localeCompare(String(b.title), "es", { sensitivity: "base" });
  });
  const excludedIds = new Set(options.excludeGameIds || []);
  return ranked.find((game) => !excludedIds.has(game.id)) || ranked[0] || null;
}

export async function saveTodayPlan(uid, game, reason = "generated") {
  const date = todayISO();
  if (!game) return null;
  const plan = {
    id: date,
    date,
    gameId: game.id,
    consoleId: game.consoleId,
    reason,
    generatedAt: Date.now()
  };
  await upsertItem(uid, "dailyPlans", plan);
  return plan;
}

export function getTodayPlan(data) {
  const date = todayISO();
  return data.dailyPlans.find((plan) => plan.id === date || plan.date === date) || null;
}
