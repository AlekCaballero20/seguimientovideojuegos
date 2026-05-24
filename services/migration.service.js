import { batchUpsert } from "../firebase/firestore.service.js";
import { LS_KEY } from "../utils/constants.js";

function getOldData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasLegacyData() {
  const data = getOldData();
  return Boolean(data && (Array.isArray(data.consoles) || Array.isArray(data.games) || Array.isArray(data.history)));
}

function convertLegacyPayload(legacy, options = {}) {
  const missingDuration = Number.isFinite(options.missingDuration) ? options.missingDuration : 30;
  const now = Date.now();
  const consoles = (legacy.consoles || []).map((consoleItem) => ({
    id: consoleItem.id || crypto.randomUUID(),
    name: consoleItem.name || "Consola sin nombre",
    icon: consoleItem.icon || "🎮",
    color: consoleItem.color || "#55b6ff",
    weight: Number(consoleItem.weight) || 1,
    createdAt: consoleItem.createdAt || now
  }));

  const activeCountByConsole = new Map();
  const games = (legacy.games || []).map((game) => {
    let category = "secondary";
    if (game.status === "done" || game.status === "completed" || game.completedAt) category = "completed";
    else if (game.status === "paused") category = "paused";
    else if (game.status === "wishlist") category = "wishlist";
    else {
      const count = activeCountByConsole.get(game.consoleId) || 0;
      category = count < 2 ? "main" : "secondary";
      activeCountByConsole.set(game.consoleId, count + 1);
    }

    return {
      id: game.id || crypto.randomUUID(),
      title: game.title || "Juego sin nombre",
      consoleId: game.consoleId || consoles[0]?.id || "",
      category,
      allowInRotation: category === "main" || category === "secondary",
      progress: Number(game.progress) || 0,
      priority: Number(game.priority) || 3,
      estimatedMinutes: Number(game.estimatedMinutes) || 60,
      notes: game.notes || "",
      addedAt: game.addedAt || now,
      startedAt: game.startedAt || null,
      lastPlayed: game.lastPlayed || null,
      completedAt: game.completedAt || null,
      totalMinutes: 0,
      sessionsCount: 0,
      ratingSum: 0
    };
  });

  const sessions = (legacy.history || []).map((session) => {
    const playedAt = session.playedAt || (session.date ? new Date(`${session.date}T12:00:00`).getTime() : now);
    const game = games.find((g) => g.id === session.gameId);
    return {
      id: session.id || crypto.randomUUID(),
      gameId: session.gameId,
      consoleId: session.consoleId || game?.consoleId || "",
      categoryAtPlay: game?.category || "secondary",
      playedAt,
      date: session.date || new Date(playedAt).toISOString().slice(0, 10),
      duration: Number(session.duration) || missingDuration,
      rating: Number(session.rating) || null,
      note: session.note || "",
      mood: session.mood || "",
      progress: Number(session.progress) || null
    };
  });

  for (const game of games) {
    const gameSessions = sessions.filter((s) => s.gameId === game.id);
    game.sessionsCount = gameSessions.length;
    game.totalMinutes = gameSessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    game.ratingSum = gameSessions.reduce((sum, s) => sum + (Number(s.rating) || 0), 0);
    const last = gameSessions.slice().sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))[0];
    if (last) game.lastPlayed = last.playedAt;
  }

  const dailyPlans = [];
  if (legacy.today?.date && legacy.today?.gameId) {
    dailyPlans.push({
      id: legacy.today.date,
      date: legacy.today.date,
      gameId: legacy.today.gameId,
      consoleId: legacy.today.consoleId || games.find((g) => g.id === legacy.today.gameId)?.consoleId || "",
      reason: "legacy",
      generatedAt: now
    });
  }

  return { consoles, games, sessions, dailyPlans };
}

export function convertLegacyData() {
  const legacy = getOldData();
  if (!legacy) throw new Error("No hay datos antiguos en localStorage.");
  return convertLegacyPayload(legacy);
}

export async function migrateLegacyToFirestore(uid) {
  const data = convertLegacyData();
  await batchUpsert(uid, "consoles", data.consoles);
  await batchUpsert(uid, "games", data.games);
  await batchUpsert(uid, "sessions", data.sessions);
  await batchUpsert(uid, "dailyPlans", data.dailyPlans);
  localStorage.setItem(`${LS_KEY}_migrated_at`, String(Date.now()));
  return data;
}

export async function importBackupToFirestore(uid, backup) {
  const isLegacyBackup = Array.isArray(backup.history) && !Array.isArray(backup.sessions);
  const normalized = isLegacyBackup
    ? convertLegacyPayload(backup, { missingDuration: 0 })
    : {
      consoles: Array.isArray(backup.consoles) ? backup.consoles : [],
      games: Array.isArray(backup.games) ? backup.games : [],
      sessions: Array.isArray(backup.sessions) ? backup.sessions : [],
      dailyPlans: Array.isArray(backup.dailyPlans) ? backup.dailyPlans : []
    };

  await batchUpsert(uid, "consoles", normalized.consoles);
  await batchUpsert(uid, "games", normalized.games);
  await batchUpsert(uid, "sessions", normalized.sessions);
  await batchUpsert(uid, "dailyPlans", normalized.dailyPlans);
  return { ...normalized, source: isLegacyBackup ? "legacy-backup" : "backup" };
}
