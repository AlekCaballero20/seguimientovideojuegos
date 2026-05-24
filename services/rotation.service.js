import { daysBetween, todayISO } from "../utils/dates.js";
import { upsertItem } from "../firebase/firestore.service.js";

export function playableForRotation(data, options = {}) {
  const includeSecondary = options.includeSecondary !== false;
  const includeCuriosity = Boolean(options.includeCuriosity);
  const shortSession = Boolean(options.shortSession);

  return data.games.filter((game) => {
    if (!game.consoleId) return false;
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

  return Math.max(1, categoryBase + ageBoost + progressBoost + (consoleWeight * 10) + (priority * 5) + estimatePenalty + recentPenalty + Math.random() * 12);
}

export function pickGame(data, options = {}) {
  const candidates = playableForRotation(data, options);
  if (!candidates.length) return null;

  const weighted = candidates.map((game) => ({ game, score: scoreGame(game, data, options) }));
  const total = weighted.reduce((sum, item) => sum + item.score, 0);
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.score;
    if (roll <= 0) return item.game;
  }
  return weighted.sort((a, b) => b.score - a.score)[0].game;
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
