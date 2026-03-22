/* Game Rotator — v2.0 (localStorage-only)
   Fixes + mejoras:
   ✅ Home más limpia: Consolas/Juegos colapsables (por defecto cerradas)
   ✅ Botón Stats funciona siempre (existente o inyectado)
   ✅ Marcar "✅ Jugué" desde cualquier juego (manual) sin depender de la sugerencia
   ✅ Historial permite múltiples sesiones por día (sin borrar lo ya marcado)
   ✅ Rendimiento: menos load() repetidos; DATA en memoria + commit inteligente
   ✅ Mantiene compatibilidad con tu data previa (migración suave)
*/

const LS_KEY = "rotator_v1";

const $ = (sel) => document.querySelector(sel);

const modal = $("#modal");
const modalTitle = $("#modalTitle");
const modalBody = $("#modalBody");
const modalOk = $("#modalOk");

const todayTag = $("#todayTag");
const todayBox = $("#todayBox");

const consolesList = $("#consolesList");
const gamesList = $("#gamesList");

const btnAddConsole = $("#btnAddConsole");
const btnAddGame = $("#btnAddGame");
const btnPlayed = $("#btnPlayed");
const btnSwap = $("#btnSwap");
const btnComplete = $("#btnComplete");
const btnReset = $("#btnReset");
const btnInstall = $("#btnInstall");

let deferredPrompt = null;

// Estado UI (no se guarda en LS)
const UI = (window.__rotUI = window.__rotUI || {
  q: "",
  f: "all",
  view: "main",         // main | stats
  statsTab: "resumen",  // resumen | historico | juegos
  statsGameId: null,

  // New: secciones colapsables home
  showConsoles: false,
  showGames: false
});

// DATA in-memory (menos IO)
let DATA = null;

// Chart.js instances (destroy before re-render)
const _charts = {};
function destroyChart(id) {
  if (_charts[id]) { try { _charts[id].destroy(); } catch {} delete _charts[id]; }
}

/* ---------------------------
   Utils
--------------------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToMs(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt.getTime();
}

function msToISO(ms) {
  if (!ms && ms !== 0) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return msToISO(d.getTime());
}

function diffDaysMs(aMs, bMs) {
  return Math.max(0, Math.floor((aMs - bMs) / 86400000));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

function byId(arr, id) {
  return arr.find((x) => x.id === id) || null;
}

function activeGamesForConsole(data, consoleId) {
  return data.games.filter((g) => g.consoleId === consoleId && g.status === "active");
}

function safeNum(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function nowMs() {
  return Date.now();
}

/* ---------------------------
   Storage (load/save/seed/migrate)
--------------------------- */

function seed() {
  const now = nowMs();
  const data = {
    meta: { createdAt: now, version: "1.7" },
    consoles: [
      { id: uid("c"), name: "PS5", weight: 1 },
      { id: uid("c"), name: "Switch", weight: 1 }
    ],
    games: [
      {
        id: uid("g"),
        consoleId: null,
        title: "Agregar juegos 👇",
        status: "active",
        addedAt: now,
        startedAt: null,
        lastPlayed: null,
        completedAt: null
      }
    ],
    history: [], // {date, consoleId, gameId, playedAt}
    today: null, // {date, consoleId, gameId}
    skips: {}    // { "YYYY-MM-DD": [{consoleId, gameId}, ...] }
  };

  data.games[0].consoleId = data.consoles[0].id;
  return data;
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch {
    return seed();
  }
}

function save(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function snapshot(data) {
  try { return JSON.stringify(data); } catch { return ""; }
}

// Migración suave (compatible con data vieja)
function migrate(data) {
  if (!data || typeof data !== "object") return seed();
  if (!Array.isArray(data.consoles)) data.consoles = [];
  if (!Array.isArray(data.games)) data.games = [];
  if (!Array.isArray(data.history)) data.history = [];
  if (!data.meta) data.meta = { createdAt: nowMs() };
  if (!data.skips || typeof data.skips !== "object") data.skips = {};
  if (!("today" in data)) data.today = null;

  const now = nowMs();
  data.meta.version = data.meta.version || "1.1";

  for (const g of data.games) {
    if (!("addedAt" in g) || !g.addedAt) g.addedAt = now;
    if (!("startedAt" in g)) g.startedAt = null;
    if (!("lastPlayed" in g)) g.lastPlayed = null;
    if (!("completedAt" in g)) g.completedAt = null;
    if (!("status" in g)) g.status = "active";
    if (!("progress" in g)) g.progress = null;
  }

  for (const h of data.history) {
    if (!("playedAt" in h) || !h.playedAt) {
      const ms = isoToMs(h.date);
      h.playedAt = ms || null;
    }
    if (!("rating" in h)) h.rating = null;
    if (!("note" in h)) h.note = null;
    if (!("duration" in h)) h.duration = null;
  }

  hydrateGameDerivedFromHistory(data);
  pruneDanglingRefs(data);

  data.meta.version = "2.0";
  return data;
}

function pruneDanglingRefs(data) {
  const gameIds = new Set(data.games.map(g => g.id));
  const consoleIds = new Set(data.consoles.map(c => c.id));

  data.history = data.history.filter(h => gameIds.has(h.gameId) && consoleIds.has(h.consoleId));

  if (data.today?.gameId && !gameIds.has(data.today.gameId)) data.today = null;
  if (data.today?.consoleId && !consoleIds.has(data.today.consoleId)) data.today = null;

  if (data.skips && typeof data.skips === "object") {
    for (const day of Object.keys(data.skips)) {
      data.skips[day] = (data.skips[day] || []).filter(s => gameIds.has(s.gameId) && consoleIds.has(s.consoleId));
    }
  }
}

function hydrateGameDerivedFromHistory(data) {
  const first = new Map(); // gameId -> ms
  const last = new Map();  // gameId -> ms

  for (const h of data.history) {
    if (!h?.gameId || !h?.date) continue;
    const ms = h.playedAt || isoToMs(h.date) || null;
    if (!ms) continue;

    const prevFirst = first.get(h.gameId);
    if (!prevFirst || ms < prevFirst) first.set(h.gameId, ms);

    const prevLast = last.get(h.gameId);
    if (!prevLast || ms > prevLast) last.set(h.gameId, ms);
  }

  for (const g of data.games) {
    if (!g.startedAt && first.has(g.id)) g.startedAt = first.get(g.id);
    if (!g.lastPlayed && last.has(g.id)) g.lastPlayed = last.get(g.id);
  }
}

/* ---------------------------
   Toast + micro-animaciones
--------------------------- */

let toastEl = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.id = "toast";
  toastEl.style.position = "fixed";
  toastEl.style.left = "50%";
  toastEl.style.bottom = "64px";
  toastEl.style.transform = "translateX(-50%)";
  toastEl.style.padding = "10px 12px";
  toastEl.style.border = "1px solid rgba(255,255,255,.10)";
  toastEl.style.background = "rgba(17,24,39,.92)";
  toastEl.style.color = "#e5e7eb";
  toastEl.style.borderRadius = "14px";
  toastEl.style.boxShadow = "0 12px 30px rgba(0,0,0,.45)";
  toastEl.style.backdropFilter = "blur(10px)";
  toastEl.style.fontWeight = "700";
  toastEl.style.fontSize = "13px";
  toastEl.style.zIndex = "9999";
  toastEl.style.maxWidth = "min(520px, 92vw)";
  toastEl.style.textAlign = "center";
  toastEl.style.opacity = "0";
  toastEl.style.pointerEvents = "none";
  document.body.appendChild(toastEl);
  return toastEl;
}

function toast(msg) {
  const t = ensureToast();
  t.textContent = msg;
  t.getAnimations().forEach(a => a.cancel());
  t.animate(
    [
      { opacity: 0, transform: "translateX(-50%) translateY(8px) scale(.98)" },
      { opacity: 1, transform: "translateX(-50%) translateY(0) scale(1)" },
      { opacity: 1, offset: 0.75 },
      { opacity: 0, transform: "translateX(-50%) translateY(6px) scale(.99)" }
    ],
    { duration: 2200, easing: "cubic-bezier(.2,.9,.2,1)" }
  );
}

function pulse(elm) {
  if (!elm) return;
  elm.getAnimations().forEach(a => a.cancel());
  elm.animate([{ transform: "scale(1)" }, { transform: "scale(1.01)" }, { transform: "scale(1)" }], {
    duration: 240, easing: "ease-out"
  });
}

function flipSwap(elm) {
  if (!elm) return;
  elm.getAnimations().forEach(a => a.cancel());
  elm.animate([{ opacity: 0.2, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], {
    duration: 220, easing: "ease-out"
  });
}

/* ---------------------------
   Session helpers (v2.0)
--------------------------- */

function formatDuration(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function ratingEmoji(r) {
  if (r === 1) return '😐';
  if (r === 2) return '😊';
  if (r === 3) return '🔥';
  return '';
}

/* ---------------------------
   Stats derivadas
--------------------------- */

function uniqueDatesFromHistoryForGame(data, gameId) {
  const set = new Set();
  for (const h of data.history) {
    if (h.gameId === gameId && h.date) set.add(h.date);
  }
  return Array.from(set).sort();
}

function longestStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  let best = 1;
  let cur = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = isoToMs(sortedDates[i - 1]);
    const curMs = isoToMs(sortedDates[i]);
    if (!prev || !curMs) continue;

    const diff = diffDaysMs(curMs, prev);
    if (diff === 1) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

function currentStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  let cur = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    const a = isoToMs(sortedDates[i]);
    const b = isoToMs(sortedDates[i - 1]);
    if (!a || !b) break;
    const diff = diffDaysMs(a, b);
    if (diff === 1) cur++;
    else break;
  }
  return cur;
}

function avgGapDays(sortedDates) {
  if (sortedDates.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = isoToMs(sortedDates[i - 1]);
    const cur = isoToMs(sortedDates[i]);
    if (!prev || !cur) continue;
    sum += diffDaysMs(cur, prev);
    n++;
  }
  if (!n) return null;
  return sum / n;
}

function computeGameStats(data, gameId) {
  const g = byId(data.games, gameId);
  const dates = uniqueDatesFromHistoryForGame(data, gameId);

  const sessions = dates.length;
  const firstDate = dates[0] || null;
  const lastDate = dates[dates.length - 1] || null;

  const now = nowMs();
  const firstMs = firstDate ? isoToMs(firstDate) : (g?.startedAt || null);
  const lastMs = lastDate ? isoToMs(lastDate) : (g?.lastPlayed || null);

  const daysSinceStart = firstMs ? diffDaysMs(now, firstMs) : null;
  const daysSinceLast = lastMs ? diffDaysMs(now, lastMs) : null;

  const best = longestStreak(dates);
  const cur = currentStreak(dates);
  const avgGap = avgGapDays(dates);

  const addedMs = g?.addedAt || null;
  const daysSinceAdded = addedMs ? diffDaysMs(now, addedMs) : null;

  // Session enrichment
  const entries = data.history.filter(h => h.gameId === gameId);
  const ratings = entries.map(h => h.rating).filter(r => r != null);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const durations = entries.map(h => h.duration).filter(d => d != null && d > 0);
  const totalDuration = durations.length ? durations.reduce((a, b) => a + b, 0) : null;
  const lastNoteEntry = [...entries].reverse().find(h => h.note);
  const lastNote = lastNoteEntry?.note || null;

  return {
    sessions,
    firstDate,
    lastDate,
    daysSinceStart,
    daysSinceLast,
    streakBest: best,
    streakCurrent: cur,
    avgGap,
    daysSinceAdded,
    avgRating,
    totalDuration,
    lastNote
  };
}

function lastNDaysISO(n) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(msToISO(x.getTime()));
  }
  return out;
}

function buildTimeline(data, n = 30) {
  const days = lastNDaysISO(n);
  // Para múltiples sesiones por día: quedarnos con la última de ese día
  const map = new Map();
  for (const h of data.history) map.set(h.date, h);

  return days.map(date => {
    const h = map.get(date);
    if (!h) return { date, played: false, label: "—", consoleId: null, gameId: null };
    const c = byId(data.consoles, h.consoleId);
    const g = byId(data.games, h.gameId);
    return {
      date, played: true,
      label: `${c?.name || "?"} · ${g?.title || "?"}`,
      consoleId: h.consoleId, gameId: h.gameId,
      rating: h.rating ?? null,
      note: h.note ?? null,
      duration: h.duration ?? null,
    };
  });
}

function buildMonthlyData(data, n = 6) {
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    months.push({ key, label });
  }
  const counts = {};
  for (const m of months) counts[m.key] = 0;
  for (const h of data.history) {
    const mk = h.date ? h.date.slice(0, 7) : null;
    if (mk && mk in counts) counts[mk]++;
  }
  return { labels: months.map(m => m.label), values: months.map(m => counts[m.key]) };
}

function buildHeatmap90(data) {
  const days = lastNDaysISO(90);
  const sessionMap = new Map();
  for (const h of data.history) sessionMap.set(h.date, (sessionMap.get(h.date) || 0) + 1);

  const [y, mo, d] = days[0].split('-').map(Number);
  const firstDow = new Date(y, mo - 1, d).getDay();

  const weeks = [];
  let cur = new Array(firstDow).fill(null);
  for (const day of days) {
    cur.push({ date: day, count: sessionMap.get(day) || 0 });
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  }
  if (cur.length) {
    while (cur.length < 7) cur.push(null);
    weeks.push(cur);
  }
  return weeks;
}

function computeGlobalStats(data) {
  const now = nowMs();

  const activeGames = data.games.filter(g => g.status === "active");
  const doneGames = data.games.filter(g => g.status === "done");

  const sessions = data.history.length;

  const uniqGamesPlayed = new Set(data.history.map(h => h.gameId)).size;
  const uniqConsolesUsed = new Set(data.history.map(h => h.consoleId)).size;

  const last30 = lastNDaysISO(30);
  const sessions30 = data.history.filter(h => last30.includes(h.date)).length;

  const playedDaysSet = new Set(data.history.map(h => h.date));
  const playedDays = Array.from(playedDaysSet).sort();
  const streakBest = playedDays.length ? longestStreak(playedDays) : 0;
  const streakCurrent = playedDays.length ? currentStreak(playedDays) : 0;

  const lastPlayedMs = data.history.length
    ? Math.max(...data.history.map(h => safeNum(h.playedAt, 0)))
    : null;

  const daysSinceLast = lastPlayedMs ? diffDaysMs(now, lastPlayedMs) : null;

  // Top juegos (por sesiones reales, no por días únicos)
  const countByGame = new Map();
  for (const h of data.history) countByGame.set(h.gameId, (countByGame.get(h.gameId) || 0) + 1);
  const topGames = Array.from(countByGame.entries())
    .map(([gameId, n]) => ({ gameId, n, title: byId(data.games, gameId)?.title || "?" }))
    .sort((a,b) => b.n - a.n)
    .slice(0, 8);

  // Distribución por consola
  const countByConsole = new Map();
  for (const h of data.history) countByConsole.set(h.consoleId, (countByConsole.get(h.consoleId) || 0) + 1);
  const byConsole = data.consoles.map(c => ({
    consoleId: c.id,
    name: c.name,
    n: countByConsole.get(c.id) || 0
  })).sort((a,b) => b.n - a.n);

  return {
    activeGamesCount: activeGames.length,
    doneGamesCount: doneGames.length,
    sessions,
    uniqGamesPlayed,
    uniqConsolesUsed,
    sessions30,
    streakBest,
    streakCurrent,
    daysSinceLast,
    topGames,
    byConsole
  };
}

/* ---------------------------
   Rotation logic
--------------------------- */

function buildCandidatePairs(data) {
  const pairs = [];
  for (const c of data.consoles) {
    const active = activeGamesForConsole(data, c.id);
    for (const g of active) pairs.push({ consoleId: c.id, gameId: g.id });
  }
  return pairs;
}

function scorePair(data, pair) {
  const g = byId(data.games, pair.gameId);
  const c = byId(data.consoles, pair.consoleId);
  if (!g || !c) return 999;

  const now = nowMs();
  let score = 0;

  // Unplayed boost
  if (!g.lastPlayed) {
    const daysSinceAdded = g.addedAt ? diffDaysMs(now, g.addedAt) : 0;
    score -= 60;
    score -= clamp(daysSinceAdded, 0, 30) * 0.6;
  } else {
    const daysAgo = diffDaysMs(now, g.lastPlayed);
    score -= clamp(daysAgo, 0, 120) * 0.7;
    if (daysAgo >= 14) score -= clamp(daysAgo - 14, 0, 60) * 0.15;
  }

  // Fairness consola últimas 14 sesiones
  const recent = data.history.slice(-14);
  const consoleCount = recent.filter((h) => h.consoleId === pair.consoleId).length;
  score += consoleCount * 4.2;

  // Peso consola
  const w = Math.max(0.25, safeNum(c.weight, 1));
  score += (1 / w) * 2.0;

  // Rating affinity (higher rating = more enjoyable = lower score = more likely to be picked)
  const gStats = computeGameStats(data, pair.gameId);
  if (gStats.avgRating != null) score -= (gStats.avgRating - 2) * 2.5;

  // Status
  if (g.status !== "active") score += 999;

  // Evita repetir exactamente lo de ayer si se cuela
  const y = yesterdayISO();
  const yPick = data.history.slice().reverse().find(h => h.date === y); // última sesión del día anterior
  if (yPick && yPick.gameId === pair.gameId && yPick.consoleId === pair.consoleId) {
    score += 30;
  }

  return score;
}

function pickToday(data, { forceNew = false } = {}) {
  const t = todayISO();

  if (!data.skips) data.skips = {};
  if (!data.skips[t]) data.skips[t] = [];

  if (!forceNew && data.today && data.today.date === t) return data.today;

  let pairs = buildCandidatePairs(data).filter((p) => {
    const g = byId(data.games, p.gameId);
    return g && g.status === "active";
  });

  if (!pairs.length) {
    data.today = { date: t, consoleId: null, gameId: null };
    return data.today;
  }

  const skipped = data.skips[t];
  pairs = pairs.filter((p) => !skipped.some((s) => s.consoleId === p.consoleId && s.gameId === p.gameId));

  if (!pairs.length) {
    data.skips[t] = [];
    pairs = buildCandidatePairs(data).filter((p) => {
      const g = byId(data.games, p.gameId);
      return g && g.status === "active";
    });
  }

  const y = yesterdayISO();
  const yPick = data.history.slice().reverse().find(h => h.date === y);
  if (yPick) {
    const notYesterday = pairs.filter((p) => !(p.consoleId === yPick.consoleId && p.gameId === yPick.gameId));
    if (notYesterday.length) pairs = notYesterday;
  }

  const scored = pairs
    .map((p) => ({ ...p, score: scorePair(data, p) }))
    .sort((a, b) => a.score - b.score);

  const choice = scored[0];
  data.today = { date: t, consoleId: choice.consoleId, gameId: choice.gameId };
  return data.today;
}

/* ---------------------------
   Mensajes dinámicos
--------------------------- */

function seededPick(items, seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % items.length;
  return items[idx];
}

function buildDailyMessage(data, todayPick) {
  const t = todayISO();
  const skippedCount = (data.skips?.[t]?.length || 0);

  if (!todayPick?.consoleId || !todayPick?.gameId) {
    return "Agrega consolas y 1–2 juegos activos por consola y esto despega solo. 🚀";
  }

  const g = byId(data.games, todayPick.gameId);
  const c = byId(data.consoles, todayPick.consoleId);
  const s = computeGameStats(data, todayPick.gameId);

  const base = [
    `Hoy es día de ${c?.name || "esa consola misteriosa"} 🎮`,
    `Plan simple: juegas un rato y ya. No es terapia. 😌`,
    `Esto no se va a jugar solo, nea. Tú puedes. 💪`
  ];

  const unplayed = [
    `Primera vez con este juego. Cero presión, solo arranca. 👀`,
    `Backlog nuevo: si no lo juegas hoy, te va a juzgar en silencio. 😶`,
    `Nunca jugado. Hoy se rompe la maldición. ✨`
  ];

  const comeback = [
    `Hace rato no tocabas este. Regreso digno. 🔥`,
    `Este estaba abandonado. Hoy lo rescatamos. 🛟`,
    `Volver también es avanzar. Sí, aunque duela. 🤝`
  ];

  const skipper = [
    `Has cambiado sugerencia ${skippedCount} veces hoy… tú y tus decisiones. 😌`,
    `Cambios hoy: ${skippedCount}. El backlog te está viendo. 👁️`,
    `Tanta duda y al final terminas en el menú principal. No me hagas eso. 😭`
  ];

  const streaky = [
    `Vas en racha. No la sueltes. 🔥`,
    `Racha activa: ${s.streakCurrent} día(s). Eso ya es disciplina. 💪`,
    `Esa racha se está formando, pilas. 👀`
  ];

  let pool = base;

  if (skippedCount >= 3) pool = pool.concat(skipper);
  if (g && !g.lastPlayed) pool = pool.concat(unplayed);
  if (g && g.lastPlayed && (s.daysSinceLast ?? 0) >= 10) pool = pool.concat(comeback);
  if (s.streakCurrent >= 2) pool = pool.concat(streaky);

  return seededPick(pool, `${t}_${todayPick.gameId}_${skippedCount}`);
}

/* ---------------------------
   UI: Views (main / stats) + Home Sections
--------------------------- */

function ensureViews() {
  const main = $("#main");
  if (!main) return;

  // 1) Stats button: si ya existe en HTML, úsalo. Si no, inyéctalo.
  const topActions = document.querySelector(".top-actions");

  let statsBtn = document.querySelector("#btnStats");
  if (!statsBtn && topActions) {
    statsBtn = document.createElement("button");
    statsBtn.id = "btnStats";
    statsBtn.className = "btn ghost";
    statsBtn.textContent = "📊 Stats";
    statsBtn.title = "Abrir Stats Center";
    topActions.appendChild(statsBtn);
  }

  // Asegurar handler (una sola vez)
  if (statsBtn && !statsBtn.__wired) {
    statsBtn.__wired = true;
    statsBtn.addEventListener("click", () => {
      UI.view = UI.view === "stats" ? "main" : "stats";
      render();
      if (UI.view === "stats") toast("Stats Center abierto 📊");
    });
  }

  // 2) Stats view: inject
  if (!$("#statsView")) {
    const stats = el(`
      <section id="statsView" class="card view" hidden aria-label="Stats Center">
        <div class="card-head">
          <h2>Stats Center</h2>
          <span class="tag" id="statsTag">—</span>
        </div>

        <div class="subhint" style="margin-bottom:10px;">
          Histórico y estadísticas sin dramas. Todo local. Todo tuyo. 🧠
        </div>

        <div class="row" style="gap:10px; align-items:center; justify-content:space-between;">
          <div class="row" style="gap:10px; align-items:center;">
            <select id="statsGameSelect" aria-label="Seleccionar juego para stats"></select>
            <button id="btnBackMain" class="btn ghost" title="Volver al plan">⬅ Volver</button>
          </div>
          <div class="subhint" id="statsMiniNote" style="margin:0;">—</div>
        </div>

        <div class="tabs" role="tablist" aria-label="Secciones de estadísticas">
          <button class="tab" role="tab" data-tab="resumen" aria-selected="true">Resumen</button>
          <button class="tab" role="tab" data-tab="historico" aria-selected="false">Histórico</button>
          <button class="tab" role="tab" data-tab="juegos" aria-selected="false">Juegos</button>
        </div>

        <div class="tab-panels">
          <div class="panel" data-panel="resumen"></div>
          <div class="panel" data-panel="historico" hidden></div>
          <div class="panel" data-panel="juegos" hidden></div>
        </div>
      </section>
    `);

    // Insert right after Plan card (first card)
    const firstCard = main.querySelector(".card");
    if (firstCard && firstCard.parentNode) {
      firstCard.insertAdjacentElement("afterend", stats);
    } else {
      main.appendChild(stats);
    }

    stats.querySelector("#btnBackMain").addEventListener("click", () => {
      UI.view = "main";
      render();
    });

    stats.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        UI.statsTab = tab.getAttribute("data-tab") || "resumen";
        render();
      });
    });

    stats.querySelector("#statsGameSelect").addEventListener("change", (e) => {
      UI.statsGameId = e.target.value || null;
      render();
    });
  }

  // 3) Home Sections: Consolas + Juegos colapsables (sin tocar HTML original)
  // Envolvemos el grid en un contenedor colapsable por sección.
  const grid = main.querySelector(".grid");
  if (grid && !main.querySelector("#homeSections")) {
    // Crear wrapper card para secciones
    const sectionsCard = el(`
      <section id="homeSections" class="card">
        <div class="card-head">
          <h2>Gestión</h2>
          <span class="tag">Opcional</span>
        </div>
        <div class="subhint" style="margin:0 0 10px;">
          Si no quieres ver listas gigantes todo el tiempo, aquí se guardan detrás de un clic. 👌
        </div>

        <details class="collapsible" id="secConsoles">
          <summary>
            <span>🎮 Consolas</span>
            <span class="chev">▾</span>
          </summary>
          <div class="collapsible-body" id="secConsolesBody"></div>
        </details>

        <details class="collapsible" id="secGames">
          <summary>
            <span>🕹️ Juegos</span>
            <span class="chev">▾</span>
          </summary>
          <div class="collapsible-body" id="secGamesBody"></div>
        </details>
      </section>
    `);

    // Insert sectionsCard where grid was, then move grid cards inside
    grid.insertAdjacentElement("beforebegin", sectionsCard);

    const secConsolesBody = sectionsCard.querySelector("#secConsolesBody");
    const secGamesBody = sectionsCard.querySelector("#secGamesBody");

    // grid probably has 2 cards: one for consoles, one for games
    const cards = Array.from(grid.querySelectorAll(":scope > .card"));
    if (cards[0]) secConsolesBody.appendChild(cards[0]);
    if (cards[1]) secGamesBody.appendChild(cards[1]);

    // remove empty grid wrapper
    grid.remove();

    // Restore open state from UI
    const dCon = sectionsCard.querySelector("#secConsoles");
    const dGam = sectionsCard.querySelector("#secGames");
    dCon.open = !!UI.showConsoles;
    dGam.open = !!UI.showGames;

    dCon.addEventListener("toggle", () => { UI.showConsoles = dCon.open; });
    dGam.addEventListener("toggle", () => { UI.showGames = dGam.open; });
  }
}

function setViewMode() {
  const statsView = $("#statsView");
  const planCard = document.querySelector("#hPlan")?.closest?.(".card");
  const sections = document.querySelector("#homeSections");

  if (!statsView || !planCard) return;

  const isStats = UI.view === "stats";
  statsView.hidden = !isStats;

  planCard.hidden = isStats;
  if (sections) sections.hidden = isStats;
}

function wireTodayBoxToStats(data) {
  // Click on plan opens Stats Center + selects today game
  const today = data.today;
  if (todayBox && today?.gameId && today?.consoleId) {
    todayBox.onclick = () => {
      UI.view = "stats";
      UI.statsTab = "resumen";
      UI.statsGameId = today.gameId;
      render();
      toast("Stats del juego abierto 📊");
    };
  } else {
    if (todayBox) todayBox.onclick = null;
  }
}

/* ---------------------------
   UI render
--------------------------- */

function renderTodayBox(data) {
  const t = todayISO();
  const today = data.today;

  if (!today || !today.consoleId || !today.gameId) {
    todayBox.innerHTML = `
      <div class="kv">
        <span class="pill">No hay plan todavía 😶</span>
      </div>
      <p class="hint">Agrega consolas y pon 1–2 juegos activos por consola para que el rotador funcione.</p>
    `;
    return;
  }

  const c = byId(data.consoles, today.consoleId);
  const g = byId(data.games, today.gameId);
  const skippedCount = (data.skips?.[t]?.length || 0);
  const stats = computeGameStats(data, today.gameId);

  // Reminder banner
  const globalForReminder = computeGlobalStats(data);
  const todayAlreadyPlayed = data.history.some(h => h.date === t);
  const showReminder = globalForReminder.daysSinceLast != null
    && globalForReminder.daysSinceLast >= 2
    && !todayAlreadyPlayed;

  const lastPlayedStr = g?.lastPlayed ? `${new Date(g.lastPlayed).toLocaleString("es-CO")}` : "Nunca";
  const sinceStart = stats.daysSinceStart != null ? `${stats.daysSinceStart} día(s) desde que lo empezaste` : "Aún no lo has empezado";
  const sinceLast = stats.daysSinceLast != null ? `· ${stats.daysSinceLast} día(s) desde la última vez` : "";
  const sessions = `· ${stats.sessions} día(s) jugado`;
  const streak = stats.sessions ? `· Racha máx: ${stats.streakBest}` : "";

  const timeline7 = buildTimeline(data, 7)
    .map(d => {
      const dot = d.played ? "✅" : "·";
      const label = d.played ? escapeHtml(d.label) : "—";
      return `<div style="display:flex;gap:10px;align-items:baseline;padding:2px 0;">
        <span style="width:22px;opacity:.9">${dot}</span>
        <span style="width:98px;opacity:.75;font-size:12px;">${escapeHtml(d.date)}</span>
        <span style="opacity:.95;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width: 520px;">${label}</span>
      </div>`;
    })
    .join("");

  const global = computeGlobalStats(data);
  const mini = `
    <div class="mini-stats" aria-label="Mini estadísticas rápidas">
      <div class="kpi"><div class="k">Racha actual</div><div class="v">${global.streakCurrent}</div></div>
      <div class="kpi"><div class="k">Racha máx</div><div class="v">${global.streakBest}</div></div>
      <div class="kpi"><div class="k">Sesiones (30d)</div><div class="v">${global.sessions30}</div></div>
      <div class="kpi"><div class="k">Juegos jugados</div><div class="v">${global.uniqGamesPlayed}</div></div>
    </div>
  `;

  todayBox.innerHTML = `
    ${showReminder ? `
      <div class="reminder-banner">
        ⏰ <b>Llevas ${globalForReminder.daysSinceLast} día${globalForReminder.daysSinceLast !== 1 ? 's' : ''} sin sesión.</b>
        Hoy es buen día para retomar. 🎮
      </div>
    ` : ''}
    <div class="kv">
      <span class="pill">Consola: <b>${escapeHtml(c?.name || "—")}</b></span>
      <span class="pill">Juego: <b>${escapeHtml(g?.title || "—")}</b></span>
      <span class="pill">Estado: <b>${g?.status === "active" ? "Por pasar" : "Completado"}</b></span>
    </div>

    <div class="subhint">
      Última vez jugado: ${lastPlayedStr}
      ${sessions}
      ${sinceLast}
      ${streak}
      ${skippedCount ? ` · Cambios hoy: ${skippedCount}` : ``}
    </div>

    <div class="subhint">⏳ ${sinceStart}</div>

    ${mini}

    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">
      <div class="subhint" style="margin:0 0 6px;">Últimos 7 días</div>
      <div>${timeline7}</div>
    </div>
  `;
}

function renderConsoles(data) {
  consolesList.innerHTML = "";
  for (const c of data.consoles) {
    const activeCount = activeGamesForConsole(data, c.id).length;

    // última sesión de esa consola (por playedAt)
    const last = data.history
      .slice()
      .filter(h => h.consoleId === c.id)
      .sort((a,b) => safeNum(b.playedAt, 0) - safeNum(a.playedAt, 0))[0] || null;

    const lastStr = last ? last.date : "—";

    consolesList.appendChild(
      el(`
        <div class="item">
          <div class="meta">
            <div class="title">${escapeHtml(c.name)}</div>
            <div class="sub">Activos: ${activeCount}/2 · Último uso: ${escapeHtml(lastStr)}</div>
          </div>
          <div class="mini">
            <span class="badge">peso: ${safeNum(c.weight, 1)}</span>
            <button class="btn ghost" data-action="editConsole" data-id="${c.id}">Editar</button>
            <button class="btn ghost" data-action="delConsole" data-id="${c.id}">Borrar</button>
          </div>
        </div>
      `)
    );
  }
}

function renderGames(data) {
  gamesList.innerHTML = "";

  const toolbar = el(`
    <div class="item" style="align-items:center;">
      <div class="meta" style="width:100%;">
        <div class="title">Explorar juegos</div>
        <div class="sub">Ahora puedes marcar "✅ Jugué" desde aquí sin depender del plan.</div>
      </div>
      <div class="mini" style="gap:10px;">
        <input id="qGames" placeholder="Buscar..." />
        <select id="filterGames">
          <option value="all">Todos</option>
          <option value="active">Por pasar</option>
          <option value="done">Completados</option>
          <option value="unplayed">Nunca jugados</option>
        </select>
      </div>
    </div>
  `);
  gamesList.appendChild(toolbar);

  const $q = toolbar.querySelector("#qGames");
  const $f = toolbar.querySelector("#filterGames");
  $q.value = UI.q;
  $f.value = UI.f;

  // Mejor: no re-render global por cada letra, solo re-render de games con throttling mini
  let tmr = null;
  const schedule = () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => {
      UI.q = $q.value.trim().toLowerCase();
      UI.f = $f.value;
      render(); // simple, estable, suficiente
    }, 60);
  };

  $q.oninput = schedule;
  $f.onchange = schedule;

  let list = data.games.slice();

  if (UI.q) list = list.filter(g => (g.title || "").toLowerCase().includes(UI.q));
  if (UI.f === "active") list = list.filter(g => g.status === "active");
  if (UI.f === "done") list = list.filter(g => g.status === "done");
  if (UI.f === "unplayed") list = list.filter(g => !g.lastPlayed && g.status === "active");

  // Sorting: never-played first, then más tiempo sin jugar
  list.sort((a, b) => {
    const au = !a.lastPlayed ? 1 : 0;
    const bu = !b.lastPlayed ? 1 : 0;
    if (au !== bu) return bu - au;

    const ad = a.lastPlayed ? diffDaysMs(nowMs(), a.lastPlayed) : 9999;
    const bd = b.lastPlayed ? diffDaysMs(nowMs(), b.lastPlayed) : 9999;
    return bd - ad;
  });

  for (const g of list) {
    const c = byId(data.consoles, g.consoleId);
    const statusLabel = g.status === "active" ? "Por pasar" : "Completado";
    const stats = computeGameStats(data, g.id);

    const extra = g.status === "active"
      ? (!g.lastPlayed ? "· Nunca jugado 👀" : `· Hace ${stats.daysSinceLast ?? "?"} día(s)`)
      : (g.completedAt ? `· ${new Date(g.completedAt).toLocaleDateString("es-CO")}` : "");

    // ✅ Nuevo: botón "Jugué" manual (solo si activo; si está done igual puedes marcar, pero es raro)
    const canManualPlay = true;

    gamesList.appendChild(
      el(`
        <div class="item">
          <div class="meta">
            <div class="title">${escapeHtml(g.title)}</div>
            <div class="sub">
              ${escapeHtml(c?.name || "Sin consola")} · ${statusLabel}
              ${g.lastPlayed ? `· Última: ${new Date(g.lastPlayed).toLocaleDateString("es-CO")}` : ""}
              ${extra ? ` ${escapeHtml(extra)}` : ""}
            </div>
            ${g.progress ? `<div style="margin-top:4px;"><span class="progress-badge">📍 ${escapeHtml(g.progress)}</span></div>` : ''}
          </div>
          <div class="mini">
            <span class="badge">${statusLabel}</span>
            ${canManualPlay ? `<button class="btn primary" data-action="markPlayedManual" data-id="${g.id}">✅ Jugué</button>` : ""}
            <button class="btn ghost" data-action="editProgress" data-id="${g.id}">📍 ${g.progress ? escapeHtml(g.progress) : 'Progreso'}</button>
            <button class="btn ghost" data-action="openStatsCenter" data-id="${g.id}">📊 Stats</button>
            <button class="btn ghost" data-action="toggleGame" data-id="${g.id}">
              ${g.status === "active" ? "Completar" : "Reactivar"}
            </button>
            <button class="btn ghost" data-action="editGame" data-id="${g.id}">Editar</button>
            <button class="btn ghost" data-action="delGame" data-id="${g.id}">Borrar</button>
          </div>
        </div>
      `)
    );
  }
}

function updateMainHint(data) {
  const hint = document.querySelector(".card .hint");
  if (!hint) return;
  hint.textContent = buildDailyMessage(data, data.today);
}

function ensureToday(data) {
  const t = todayISO();
  if (!data.today || data.today.date !== t) pickToday(data);
}

function ensureSeedStatsGame(data) {
  if (UI.statsGameId && byId(data.games, UI.statsGameId)) return;
  if (data.today?.gameId && byId(data.games, data.today.gameId)) {
    UI.statsGameId = data.today.gameId;
    return;
  }
  const active = data.games.find(g => g.status === "active");
  if (active) { UI.statsGameId = active.id; return; }
  if (data.games[0]) UI.statsGameId = data.games[0].id;
}

function renderStatsCenter(data) {
  const statsView = $("#statsView");
  if (!statsView) return;

  $("#statsTag").textContent = `Hoy: ${todayISO()}`;

  ensureSeedStatsGame(data);

  const sel = $("#statsGameSelect");
  if (sel) {
    const prev = sel.value;
    const gamesSorted = data.games.slice().sort((a,b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return String(a.title||"").localeCompare(String(b.title||""), "es");
    });

    sel.innerHTML = gamesSorted.map(g => {
      const c = byId(data.consoles, g.consoleId);
      const tag = g.status === "active" ? "Por pasar" : "Completado";
      const name = `${g.title} · ${c?.name || "Sin consola"} · ${tag}`;
      return `<option value="${g.id}" ${g.id === UI.statsGameId ? "selected" : ""}>${escapeHtml(name)}</option>`;
    }).join("");

    if (prev && prev !== sel.value && byId(data.games, prev)) sel.value = prev;
  }

  statsView.querySelectorAll(".tab").forEach(tab => {
    const id = tab.getAttribute("data-tab");
    tab.setAttribute("aria-selected", id === UI.statsTab ? "true" : "false");
  });
  statsView.querySelectorAll(".panel").forEach(p => {
    const id = p.getAttribute("data-panel");
    p.hidden = id !== UI.statsTab;
  });

  const global = computeGlobalStats(data);
  const note = $("#statsMiniNote");
  if (note) {
    const s = global.daysSinceLast == null ? "Sin sesiones aún" : `Última sesión: hace ${global.daysSinceLast} día(s)`;
    note.textContent = `${s} · ${global.sessions} sesión(es) total`;
  }

  const panelResumen = statsView.querySelector(`[data-panel="resumen"]`);
  const panelHistorico = statsView.querySelector(`[data-panel="historico"]`);
  const panelJuegos = statsView.querySelector(`[data-panel="juegos"]`);

  if (panelResumen) {
    destroyChart('monthly');
    destroyChart('consoles');

    panelResumen.innerHTML = `
      <div class="kpi-grid" aria-label="KPIs globales">
        <div class="kpi-card"><div class="k">Racha actual</div><div class="v">${global.streakCurrent}</div><div class="s">Días seguidos</div></div>
        <div class="kpi-card"><div class="k">Racha máxima</div><div class="v">${global.streakBest}</div><div class="s">Tu mejor streak</div></div>
        <div class="kpi-card"><div class="k">Sesiones (30 días)</div><div class="v">${global.sessions30}</div><div class="s">Último mes</div></div>
        <div class="kpi-card"><div class="k">Juegos jugados</div><div class="v">${global.uniqGamesPlayed}</div><div class="s">Con al menos 1 sesión</div></div>
      </div>

      <div class="soft-card" style="margin-bottom:12px;">
        <div class="soft-title">Sesiones por mes (últimos 6 meses)</div>
        <div class="chart-wrap"><canvas id="chartMonthly"></canvas></div>
      </div>

      <div class="split">
        <div class="soft-card">
          <div class="soft-title">Distribución por consola</div>
          ${global.byConsole.some(x => x.n > 0)
            ? `<div class="chart-wrap chart-wrap--sm"><canvas id="chartConsoles"></canvas></div>`
            : `<div class="subhint" style="margin:0;">Aún no hay sesiones para mostrar. 😶</div>`
          }
          <div class="subhint" style="margin:8px 0 0;">Basado en registros reales. 😌</div>
        </div>

        <div class="soft-card">
          <div class="soft-title">Top juegos (por sesiones)</div>
          <div class="rank">
            ${
              global.topGames.length
                ? global.topGames.map((x, i) => `
                  <div class="r" title="${escapeHtml(x.title)}">
                    <div class="name">${i+1}. ${escapeHtml(x.title)}</div>
                    <div class="val">${x.n} sesión(es)</div>
                  </div>
                `).join("")
                : `<div class="subhint">Todavía no hay top. Juega algo, rey. 👑</div>`
            }
          </div>
        </div>
      </div>
    `;

    setTimeout(() => initChartsResumen(data), 0);
  }

  if (panelHistorico) {
    const timeline = buildTimeline(data, 30);
    const played30 = timeline.filter(x => x.played).length;
    const gridDays = buildTimeline(data, 14);
    const heatmapWeeks = buildHeatmap90(data);

    panelHistorico.innerHTML = `
      <div class="kpi-grid" aria-label="KPIs de histórico">
        <div class="kpi-card"><div class="k">Días con sesión (30d)</div><div class="v">${played30}</div><div class="s">De 30 días</div></div>
        <div class="kpi-card"><div class="k">Total sesiones</div><div class="v">${global.sessions}</div><div class="s">Desde el inicio</div></div>
        <div class="kpi-card"><div class="k">Juegos activos</div><div class="v">${global.activeGamesCount}</div><div class="s">Por pasar</div></div>
        <div class="kpi-card"><div class="k">Completados</div><div class="v">${global.doneGamesCount}</div><div class="s">Terminados</div></div>
      </div>

      <div class="soft-card" style="margin-bottom:12px;">
        <div class="soft-title">Actividad (últimos 90 días)</div>
        <div class="heatmap" aria-label="Mapa de calor de actividad">
          ${heatmapWeeks.map(week => `
            <div class="hm-week">
              ${week.map(day => day
                ? `<div class="hm-day ${day.count >= 2 ? 'on-hot' : day.count === 1 ? 'on' : ''}"
                        title="${escapeHtml(day.date)} · ${day.count} sesión(es)"></div>`
                : `<div class="hm-day empty"></div>`
              ).join('')}
            </div>
          `).join('')}
        </div>
        <div class="heatmap-legend">
          <span class="hm-leg-item"><span class="hm-day" style="display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);"></span> Sin sesión</span>
          <span class="hm-leg-item"><span class="hm-day on" style="display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid rgba(34,197,94,.28);background:rgba(34,197,94,.20);"></span> 1 sesión</span>
          <span class="hm-leg-item"><span class="hm-day on-hot" style="display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid rgba(34,197,94,.50);background:rgba(34,197,94,.38);"></span> 2+ sesiones</span>
        </div>
      </div>

      <div class="soft-card" style="margin-bottom:12px;">
        <div class="soft-title">Racha (14 días)</div>
        <div class="streak" aria-label="Días jugados en los últimos 14 días">
          ${gridDays.map(d => `<div class="day ${d.played ? "on" : ""}" title="${escapeHtml(d.date)} ${d.played ? "✅" : "—"}"></div>`).join("")}
        </div>
        <div class="subhint" style="margin:10px 0 0;">
          ${global.daysSinceLast == null ? "Sin sesiones todavía. 😌" : `Última sesión hace ${global.daysSinceLast} día(s).`}
        </div>
      </div>

      <div class="soft-card">
        <div class="soft-title">Histórico (30 días)</div>
        <div class="history">
          ${timeline.slice().reverse().map(d => {
            const rStr = d.rating ? ratingEmoji(d.rating) : '';
            const durStr = d.duration ? formatDuration(d.duration) : '';
            const extras = [rStr, durStr].filter(Boolean).join(' · ');
            const noteHtml = d.note
              ? `<div style="padding:2px 34px 6px;font-size:11px;color:rgba(156,163,175,.85);font-style:italic;">"${escapeHtml(d.note.slice(0,80))}${d.note.length > 80 ? '…' : ''}"</div>`
              : '';
            return `
              <div class="h-row">
                <div class="dot">${d.played ? "✅" : "·"}</div>
                <div class="date">${escapeHtml(d.date)}</div>
                <div class="txt">${d.played ? escapeHtml(d.label) : "—"}</div>
                <div class="meta">${extras || (d.played ? "sesión" : "")}</div>
              </div>
              ${noteHtml}
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (panelJuegos) {
    const gameId = UI.statsGameId;
    const g = byId(data.games, gameId);
    const c = g ? byId(data.consoles, g.consoleId) : null;
    const s = g ? computeGameStats(data, gameId) : null;

    const dates = g ? uniqueDatesFromHistoryForGame(data, gameId) : [];
    const last10 = dates.slice(-10).reverse();
    const avgGap = s?.avgGap != null ? `${s.avgGap.toFixed(1)} días` : "—";
    const sinceStart = s?.daysSinceStart != null ? `${s.daysSinceStart} día(s)` : "—";
    const sinceLast = s?.daysSinceLast != null ? `${s.daysSinceLast} día(s)` : "—";

    const days14 = lastNDaysISO(14);
    const playedSet = new Set(dates);

    panelJuegos.innerHTML = `
      <div class="soft-card" style="margin-bottom:12px;">
        <div class="soft-title">Juego seleccionado</div>
        <div class="subhint" style="margin:0;">
          <b>${escapeHtml(g?.title || "—")}</b> · ${escapeHtml(c?.name || "Sin consola")} · ${g?.status === "active" ? "Por pasar" : "Completado"}
        </div>
      </div>

      <div class="kpi-grid" aria-label="KPIs del juego">
        <div class="kpi-card"><div class="k">Días jugados</div><div class="v">${s?.sessions ?? 0}</div><div class="s">Días con sesión</div></div>
        <div class="kpi-card"><div class="k">Desde inicio</div><div class="v">${sinceStart}</div><div class="s">Tiempo desde primera sesión</div></div>
        <div class="kpi-card"><div class="k">Desde última</div><div class="v">${sinceLast}</div><div class="s">Tiempo desde la última</div></div>
        <div class="kpi-card"><div class="k">Racha máx</div><div class="v">${s?.streakBest ?? 0}</div><div class="s">Mejor streak del juego</div></div>
      </div>

      <div class="split">
        <div class="soft-card">
          <div class="soft-title">Streak 14 días (del juego)</div>
          <div class="streak">
            ${days14.map(d => `<div class="day ${playedSet.has(d) ? "on" : ""}" title="${escapeHtml(d)} ${playedSet.has(d) ? "✅" : "—"}"></div>`).join("")}
          </div>
          <div class="subhint" style="margin:10px 0 0;">Gap promedio: <b>${escapeHtml(avgGap)}</b></div>
        </div>

        <div class="soft-card">
          <div class="soft-title">Últimas sesiones</div>
          ${
            last10.length
              ? last10.map(d => `<div style="font-size:12px;opacity:.92;padding:3px 0;">✅ ${escapeHtml(d)}</div>`).join("")
              : `<div class="subhint">Aún no lo has jugado. Hoy podría ser el día. 👀</div>`
          }
          ${g ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);">
            <div class="soft-title" style="margin-bottom:6px;">Sesión promedio</div>
            <div class="kv" style="gap:8px;">
              ${s.avgRating != null ? `<span class="pill">Rating medio: <b>${ratingEmoji(Math.round(s.avgRating))} ${s.avgRating.toFixed(1)}</b></span>` : ''}
              ${s.totalDuration ? `<span class="pill">Tiempo total: <b>${formatDuration(s.totalDuration)}</b></span>` : ''}
              ${g.progress ? `<span class="pill">Progreso: <b>📍 ${escapeHtml(g.progress)}</b></span>` : ''}
            </div>
            ${s.lastNote ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);font-style:italic;">"${escapeHtml(s.lastNote.slice(0,120))}${s.lastNote.length>120?'…':''}"</div>` : ''}
          </div>
        ` : ''}
          <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn ghost" data-action="openGameModalStats" data-id="${escapeHtml(gameId || "")}">Abrir modal detalle</button>
            <button class="btn ghost" data-action="jumpToMainWithThis" data-id="${escapeHtml(gameId || "")}">Volver y sugerir este</button>
          </div>
        </div>
      </div>
    `;
  }
}

/* ---------------------------
   Chart.js init (v2.0)
--------------------------- */

function initChartsResumen(data) {
  if (typeof window.Chart === 'undefined') return;

  // Monthly bar chart
  const canvasMonthly = document.getElementById('chartMonthly');
  destroyChart('monthly');
  if (canvasMonthly) {
    const { labels, values } = buildMonthlyData(data);
    _charts['monthly'] = new window.Chart(canvasMonthly, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: 'rgba(96,165,250,0.18)',
          borderColor: 'rgba(96,165,250,0.55)',
          borderWidth: 1,
          borderRadius: 6,
          hoverBackgroundColor: 'rgba(96,165,250,0.30)',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.95)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            titleColor: '#fff',
            bodyColor: 'rgba(229,231,235,0.9)',
            callbacks: { label: ctx => ` ${ctx.raw} sesión(es)` }
          }
        },
        scales: {
          x: {
            ticks: { color: 'rgba(156,163,175,0.85)', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: 'rgba(156,163,175,0.85)', font: { size: 11 }, stepSize: 1 },
            grid: { color: 'rgba(255,255,255,0.05)' },
            border: { color: 'rgba(255,255,255,0.08)' },
          }
        }
      }
    });
  }

  // Console doughnut
  const canvasConsoles = document.getElementById('chartConsoles');
  destroyChart('consoles');
  if (canvasConsoles) {
    const gl = computeGlobalStats(data);
    const active = gl.byConsole.filter(x => x.n > 0);
    if (active.length) {
      const palette = [
        'rgba(34,197,94,0.70)',
        'rgba(96,165,250,0.70)',
        'rgba(236,72,153,0.70)',
        'rgba(245,158,11,0.70)',
        'rgba(167,139,250,0.70)',
        'rgba(251,113,133,0.70)',
      ];
      _charts['consoles'] = new window.Chart(canvasConsoles, {
        type: 'doughnut',
        data: {
          labels: active.map(x => x.name),
          datasets: [{
            data: active.map(x => x.n),
            backgroundColor: palette.slice(0, active.length),
            borderColor: 'rgba(17,24,39,0.85)',
            borderWidth: 2,
            hoverOffset: 5,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: 'rgba(229,231,235,0.9)', font: { size: 11 }, padding: 10, boxWidth: 12 }
            },
            tooltip: {
              backgroundColor: 'rgba(17,24,39,0.95)',
              borderColor: 'rgba(255,255,255,0.12)',
              borderWidth: 1,
              titleColor: '#fff',
              bodyColor: 'rgba(229,231,235,0.9)',
              callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} sesión(es)` }
            }
          }
        }
      });
    }
  }
}

/* ---------------------------
   Render orchestration (no-save loop)
--------------------------- */

let lastSavedSnapshot = "";

function commit(reason = "") {
  const snap = snapshot(DATA);
  if (snap && snap !== lastSavedSnapshot) {
    save(DATA);
    lastSavedSnapshot = snap;
  }
  // reason útil si luego quieres debug logs
}

function render() {
  if (!DATA) DATA = load();

  ensureViews();

  const t = todayISO();
  if (todayTag) todayTag.textContent = `Hoy: ${t}`;

  ensureToday(DATA);
  commit("ensureToday");

  renderTodayBox(DATA);
  renderConsoles(DATA);
  renderGames(DATA);
  updateMainHint(DATA);

  setViewMode();
  wireTodayBoxToStats(DATA);

  if (UI.view === "stats") {
    renderStatsCenter(DATA);
  }

  if (!deferredPrompt && btnInstall) btnInstall.hidden = true;
}

/* ---------------------------
   Modal helpers
--------------------------- */

async function openModal({ title, bodyHtml, onOk, onMount, okLabel }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  if (modalOk) modalOk.textContent = okLabel || 'Guardar';
  onMount?.();

  const result = await new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue), { once: true });
    modal.showModal();
  });

  if (modalOk) modalOk.textContent = 'Guardar'; // reset
  if (result !== "ok") return;
  await onOk?.();
}

/* openPlayedModal: modal de sesión con rating / nota / duración */
async function openPlayedModal(gameId) {
  const g = byId(DATA.games, gameId);
  if (!g) return null;
  let confirmed = false;
  let sessionData = { rating: null, note: null, duration: null };

  await openModal({
    title: '¿Cómo estuvo la sesión? 🎮',
    okLabel: 'Registrar sesión ✅',
    bodyHtml: `
      <div class="field">
        <label>Rating (opcional)</label>
        <div class="rating-picker" id="ratingPicker">
          <button class="rating-btn" data-v="1" type="button" title="Meh">😐</button>
          <button class="rating-btn" data-v="2" type="button" title="Buena">😊</button>
          <button class="rating-btn" data-v="3" type="button" title="¡Fuego!">🔥</button>
        </div>
        <input type="hidden" id="sessionRating" value="" />
      </div>
      <div class="field">
        <label>Nota rápida (opcional)</label>
        <input id="sessionNote" placeholder="Ej: llegué al jefe final, buen ritmo..." maxlength="200" />
      </div>
      <div class="field">
        <label>Duración estimada</label>
        <select id="sessionDuration">
          <option value="">Sin registrar</option>
          <option value="15">~15 min</option>
          <option value="30">~30 min</option>
          <option value="60">~1 hora</option>
          <option value="90">~1h 30min</option>
          <option value="120">~2 horas+</option>
        </select>
      </div>
    `,
    onMount: () => {
      const picker = document.getElementById('ratingPicker');
      const hidden = document.getElementById('sessionRating');
      if (!picker || !hidden) return;
      picker.querySelectorAll('.rating-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.getAttribute('data-v');
          hidden.value = hidden.value === v ? '' : v;
          picker.querySelectorAll('.rating-btn').forEach(b =>
            b.classList.toggle('active', b.getAttribute('data-v') === hidden.value)
          );
        });
      });
    },
    onOk: () => {
      confirmed = true;
      sessionData.rating = document.getElementById('sessionRating')?.value
        ? Number(document.getElementById('sessionRating').value) : null;
      sessionData.note = document.getElementById('sessionNote')?.value.trim() || null;
      sessionData.duration = document.getElementById('sessionDuration')?.value
        ? Number(document.getElementById('sessionDuration').value) : null;
    }
  });

  return confirmed ? sessionData : null;
}

async function openStatsModal(gameId) {
  const g = byId(DATA.games, gameId);
  if (!g) return;

  const c = byId(DATA.consoles, g.consoleId);
  const s = computeGameStats(DATA, gameId);

  const dates = uniqueDatesFromHistoryForGame(DATA, gameId);
  const last10 = dates.slice(-10).reverse();

  const avgGap = s.avgGap != null ? `${s.avgGap.toFixed(1)} días` : "—";
  const sinceStart = s.daysSinceStart != null ? `${s.daysSinceStart} día(s)` : "—";
  const sinceLast = s.daysSinceLast != null ? `${s.daysSinceLast} día(s)` : "—";

  const body = `
    <div class="subhint" style="margin-bottom:10px;">
      <b>${escapeHtml(g.title)}</b> · ${escapeHtml(c?.name || "Sin consola")} · ${g.status === "active" ? "Por pasar" : "Completado"}
    </div>

    <div class="kv" style="gap:8px;">
      <span class="pill">Días jugados: <b>${s.sessions}</b></span>
      <span class="pill">Desde inicio: <b>${sinceStart}</b></span>
      <span class="pill">Desde última: <b>${sinceLast}</b></span>
      <span class="pill">Racha actual: <b>${s.streakCurrent}</b></span>
      <span class="pill">Racha máx: <b>${s.streakBest}</b></span>
      <span class="pill">Gap promedio: <b>${avgGap}</b></span>
    </div>

    <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">
      <div class="subhint" style="margin:0 0 8px;">Últimas sesiones</div>
      ${
        last10.length
          ? last10.map(d => `<div style="font-size:12px;opacity:.9;padding:2px 0;">✅ ${escapeHtml(d)}</div>`).join("")
          : `<div style="font-size:12px;opacity:.8;">Aún no lo has jugado. Hoy podría ser el día. 👀</div>`
      }
    </div>
  `;

  await openModal({
    title: "Stats del juego",
    bodyHtml: body,
    onOk: async () => {}
  });
}

/* ---------------------------
   Import / Export backups
--------------------------- */

let importInput = null;

function ensureImportInput() {
  if (importInput) return importInput;
  importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.style.display = "none";
  document.body.appendChild(importInput);
  return importInput;
}

function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportBackup() {
  try {
    const d = todayISO();
    const filename = `game-rotator-backup-${d}.json`;
    downloadText(filename, JSON.stringify(DATA, null, 2));
    toast("Backup exportado ✅");
  } catch {
    toast("No pude exportar el backup 😶");
  }
}

async function importBackupFromFile(file) {
  const text = await file.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    toast("Ese archivo no es JSON válido.");
    return;
  }

  const looksOk =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray(parsed.consoles) &&
    Array.isArray(parsed.games) &&
    Array.isArray(parsed.history) &&
    typeof parsed.meta === "object";

  if (!looksOk) {
    toast("Ese backup no parece de Game Rotator (estructura rara).");
    return;
  }

  const ok = confirm(
    "Importar backup va a REEMPLAZAR tu data actual en este dispositivo.\n\n" +
    "Tip: exporta primero por si acaso.\n\n" +
    "¿Seguro?"
  );
  if (!ok) return;

  DATA = migrate(parsed);
  save(DATA);
  lastSavedSnapshot = snapshot(DATA);
  render();
  toast("Backup importado ✅");
}

function mountBackupButtons() {
  const topActions = document.querySelector(".top-actions");
  if (!topActions) return;

  if (document.querySelector("#btnExportBackup")) return;

  const btnExport = document.createElement("button");
  btnExport.id = "btnExportBackup";
  btnExport.className = "btn ghost";
  btnExport.textContent = "Exportar";
  btnExport.title = "Descarga un backup .json";

  const btnImport = document.createElement("button");
  btnImport.id = "btnImportBackup";
  btnImport.className = "btn ghost";
  btnImport.textContent = "Importar";
  btnImport.title = "Carga un backup .json";

  btnExport.addEventListener("click", exportBackup);
  btnImport.addEventListener("click", async () => {
    const input = ensureImportInput();
    input.value = "";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await importBackupFromFile(file);
    };
    input.click();
  });

  topActions.prepend(btnImport);
  topActions.prepend(btnExport);
}

/* ---------------------------
   Core actions helpers
--------------------------- */

function recordPlayed(gameId, { alsoSetToday = false, rating = null, note = null, duration = null } = {}) {
  const g = byId(DATA.games, gameId);
  if (!g) return false;

  const t = todayISO();
  const playedAt = nowMs();

  // Permitimos múltiples sesiones por día:
  DATA.history.push({
    date: t,
    consoleId: g.consoleId,
    gameId: g.id,
    playedAt,
    rating,
    note: note || null,
    duration
  });

  g.lastPlayed = playedAt;
  if (!g.startedAt) g.startedAt = playedAt;

  if (alsoSetToday) {
    DATA.today = { date: t, consoleId: g.consoleId, gameId: g.id };
  }

  commit("recordPlayed");
  return true;
}

/* ---------------------------
   Actions (buttons)
--------------------------- */

btnAddConsole?.addEventListener("click", async () => {
  await openModal({
    title: "Agregar consola",
    bodyHtml: `
      <div class="field">
        <label>Nombre</label>
        <input id="cName" required placeholder="Ej: PS4, Xbox Series S, Switch..." />
      </div>
      <div class="field">
        <label>Peso (1 = normal, 2 = más frecuente, 0.5 = menos frecuente)</label>
        <input id="cWeight" type="number" step="0.25" value="1" />
      </div>
    `,
    onOk: () => {
      const name = $("#cName").value.trim();
      const weight = safeNum($("#cWeight").value, 1);
      if (!name) return;

      DATA.consoles.push({ id: uid("c"), name, weight: Math.max(0.25, weight || 1) });
      DATA.today = null;

      commit("addConsole");
      render();
      toast("Consola agregada ✅");
    }
  });
});

btnAddGame?.addEventListener("click", async () => {
  if (!DATA.consoles.length) {
    toast("Primero agrega al menos una consola 😌");
    return;
  }

  const options = DATA.consoles
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");

  await openModal({
    title: "Agregar juego",
    bodyHtml: `
      <div class="field">
        <label>Título</label>
        <input id="gTitle" required placeholder="Ej: God of War, Hollow Knight..." />
      </div>
      <div class="field">
        <label>Consola</label>
        <select id="gConsole">${options}</select>
      </div>
      <div class="field">
        <label>Estado</label>
        <select id="gStatus">
          <option value="active" selected>Por pasar</option>
          <option value="done">Completado</option>
        </select>
      </div>
    `,
    onOk: () => {
      const title = $("#gTitle").value.trim();
      const consoleId = $("#gConsole").value;
      const status = $("#gStatus").value;

      if (!title || !consoleId) return;

      if (status === "active") {
        const act = activeGamesForConsole(DATA, consoleId);
        if (act.length >= 2) {
          toast("Esa consola ya tiene 2 juegos activos. Completa uno primero. 😌");
          return;
        }
      }

      DATA.games.push({
        id: uid("g"),
        consoleId,
        title,
        status,
        addedAt: nowMs(),
        startedAt: null,
        lastPlayed: null,
        completedAt: status === "done" ? nowMs() : null
      });

      DATA.today = null;
      commit("addGame");
      render();
      toast(status === "active" ? "Juego agregado (por pasar) ✅" : "Juego agregado (completado) ✅");
    }
  });
});

btnPlayed?.addEventListener("click", async () => {
  pickToday(DATA);
  const today = DATA.today;
  if (!today?.consoleId || !today?.gameId) {
    toast("No hay plan para marcar. Agrega consolas/juegos primero.");
    return;
  }

  const sessionData = await openPlayedModal(today.gameId);
  if (!sessionData) return; // user cancelled

  recordPlayed(today.gameId, { alsoSetToday: true, ...sessionData });
  render();
  pulse(todayBox);

  const last7 = lastNDaysISO(7);
  const uniqueGames7 = new Set(DATA.history.filter(h => last7.includes(h.date)).map(h => h.gameId)).size;
  toast(
    uniqueGames7 >= 3
      ? `Sesión registrada ✅ · ${uniqueGames7} juegos distintos esta semana. Respeto. 🏆`
      : "Sesión registrada ✅ Mañana evitamos repetirte lo mismo."
  );
});

btnSwap?.addEventListener("click", () => {
  const t = todayISO();

  pickToday(DATA);

  if (!DATA.skips) DATA.skips = {};
  if (!DATA.skips[t]) DATA.skips[t] = [];

  if (DATA.today?.consoleId && DATA.today?.gameId) {
    DATA.skips[t].push({ consoleId: DATA.today.consoleId, gameId: DATA.today.gameId });
  }

  pickToday(DATA, { forceNew: true });

  commit("swap");
  render();
  flipSwap(todayBox);

  const n = DATA.skips[t]?.length || 0;
  toast(n >= 3 ? `Cambio #${n}. Tú sí eres indeciso(a). 😌` : "Sugerencia cambiada 🔄");
});

btnComplete?.addEventListener("click", () => {
  pickToday(DATA);
  const today = DATA.today;

  if (!today?.gameId) {
    toast("No hay juego para completar.");
    return;
  }

  const g = byId(DATA.games, today.gameId);
  if (!g) return;

  g.status = "done";
  g.completedAt = nowMs();
  DATA.today = null;

  commit("complete");
  render();

  pulse(todayBox);
  toast("Juego marcado como completado 🏁");
});

btnReset?.addEventListener("click", () => {
  const t = todayISO();

  DATA.today = null;
  if (DATA.skips && DATA.skips[t]) DATA.skips[t] = [];

  commit("reset");
  render();

  toast("Plan de hoy reseteado. Volvemos a girar la ruleta. 🎲");
});

/* ---------------------------
   Delegated clicks (list actions)
--------------------------- */

document.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");

  if (action === "openStatsCenter") {
    UI.view = "stats";
    UI.statsTab = "juegos";
    UI.statsGameId = id || null;
    render();
    toast("Stats Center abierto 📊");
    return;
  }

  if (action === "openGameModalStats") {
    if (id) await openStatsModal(id);
    return;
  }

  if (action === "editProgress") {
    const g = byId(DATA.games, id);
    if (!g) return;
    await openModal({
      title: 'Actualizar progreso',
      bodyHtml: `
        <div class="field">
          <label>Progreso actual</label>
          <input id="progressVal" value="${escapeHtml(g.progress || '')}" placeholder="Ej: 45%, Capítulo 3, Jefe 2/8..." maxlength="100" />
        </div>
      `,
      onOk: () => {
        const gg = byId(DATA.games, id);
        if (!gg) return;
        gg.progress = document.getElementById('progressVal')?.value.trim() || null;
        commit('editProgress');
        render();
        toast('Progreso actualizado ✅');
      }
    });
    return;
  }

  if (action === "markPlayedManual") {
    const g = byId(DATA.games, id);
    if (!g) return;

    const sessionData = await openPlayedModal(g.id);
    if (!sessionData) return; // user cancelled

    const ok = recordPlayed(g.id, { alsoSetToday: false, ...sessionData });
    if (!ok) return;

    render();
    toast("Sesión registrada ✅ (manual)");
    return;
  }

  if (action === "jumpToMainWithThis") {
    const g = byId(DATA.games, id);
    if (!g) return;

    if (g.status !== "active") {
      toast("Ese juego está completado. Reactívalo para sugerirlo.");
      return;
    }

    DATA.today = { date: todayISO(), consoleId: g.consoleId, gameId: g.id };
    UI.view = "main";
    commit("jumpToMainWithThis");
    render();
    toast("Listo. Plan ajustado a ese juego ✅");
    pulse(todayBox);
    return;
  }

  if (action === "delConsole") {
    const ok = confirm("¿Borrar consola? Esto no borra juegos, pero quedarán ‘sin consola’.");
    if (!ok) return;

    DATA.consoles = DATA.consoles.filter((c) => c.id !== id);
    for (const g of DATA.games) if (g.consoleId === id) g.consoleId = null;

    DATA.today = null;
    pruneDanglingRefs(DATA);
    commit("delConsole");
    render();
    toast("Consola borrada 🗑️");
    return;
  }

  if (action === "editConsole") {
    const c = byId(DATA.consoles, id);
    if (!c) return;

    await openModal({
      title: "Editar consola",
      bodyHtml: `
        <div class="field">
          <label>Nombre</label>
          <input id="cName" value="${escapeHtml(c.name)}" />
        </div>
        <div class="field">
          <label>Peso</label>
          <input id="cWeight" type="number" step="0.25" value="${safeNum(c.weight, 1)}" />
        </div>
      `,
      onOk: () => {
        const cc = byId(DATA.consoles, id);
        if (!cc) return;

        const name = $("#cName").value.trim();
        const weight = safeNum($("#cWeight").value, 1);

        if (name) cc.name = name;
        cc.weight = Math.max(0.25, weight || 1);

        DATA.today = null;
        commit("editConsole");
        render();
        toast("Consola actualizada ✅");
      }
    });
    return;
  }

  if (action === "delGame") {
    const ok = confirm("¿Borrar juego? Se va para el vacío eterno.");
    if (!ok) return;

    DATA.games = DATA.games.filter((g) => g.id !== id);
    DATA.history = DATA.history.filter((h) => h.gameId !== id);

    if (DATA.today?.gameId === id) DATA.today = null;

    if (DATA.skips) {
      for (const day of Object.keys(DATA.skips)) {
        DATA.skips[day] = (DATA.skips[day] || []).filter((s) => s.gameId !== id);
      }
    }

    pruneDanglingRefs(DATA);
    commit("delGame");
    render();
    toast("Juego borrado 🗑️");
    return;
  }

  if (action === "editGame") {
    const g = byId(DATA.games, id);
    if (!g) return;

    const options = DATA.consoles
      .map((c) => `<option value="${c.id}" ${c.id === g.consoleId ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("");

    await openModal({
      title: "Editar juego",
      bodyHtml: `
        <div class="field">
          <label>Título</label>
          <input id="gTitle" value="${escapeHtml(g.title)}" />
        </div>
        <div class="field">
          <label>Consola</label>
          <select id="gConsole">${options}</select>
        </div>
        <div class="field">
          <label>Estado</label>
          <select id="gStatus">
            <option value="active" ${g.status === "active" ? "selected" : ""}>Por pasar</option>
            <option value="done" ${g.status === "done" ? "selected" : ""}>Completado</option>
          </select>
        </div>
        <div class="field">
          <label>Progreso (opcional)</label>
          <input id="gProgress" value="${escapeHtml(g.progress || '')}" placeholder="Ej: 45%, Capítulo 3, Jefe 2/8..." maxlength="100" />
        </div>
      `,
      onOk: () => {
        const gg = byId(DATA.games, id);
        if (!gg) return;

        const title = $("#gTitle").value.trim();
        const consoleId = $("#gConsole").value;
        const status = $("#gStatus").value;

        if (title) gg.title = title;

        if (status === "active") {
          const act = activeGamesForConsole(DATA, consoleId).filter((x) => x.id !== gg.id);
          if (act.length >= 2) {
            toast("Esa consola ya tiene 2 juegos activos. Completa uno primero.");
            return;
          }
          gg.completedAt = null;
        } else {
          gg.completedAt = nowMs();
        }

        gg.consoleId = consoleId || null;
        gg.status = status;
        gg.progress = document.getElementById('gProgress')?.value.trim() || null;

        DATA.today = null;
        commit("editGame");
        render();
        toast("Juego actualizado ✅");
      }
    });
    return;
  }

  if (action === "toggleGame") {
    const g = byId(DATA.games, id);
    if (!g) return;

    if (g.status === "active") {
      g.status = "done";
      g.completedAt = nowMs();
      toast("Marcado como completado 🏁");
    } else {
      const act = activeGamesForConsole(DATA, g.consoleId);
      if (act.length >= 2) {
        toast("Esa consola ya tiene 2 juegos activos. No se puede reactivar.");
        return;
      }
      g.status = "active";
      g.completedAt = null;
      toast("Reactivado ✅");
    }

    DATA.today = null;
    commit("toggleGame");
    render();
    return;
  }
});

/* ---------------------------
   PWA install + SW
--------------------------- */

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (btnInstall) btnInstall.hidden = false;
});

btnInstall?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.hidden = true;
});

function showUpdateBanner(onUpdate) {
  let bar = document.querySelector("#updateBar");
  if (bar) return;

  bar = document.createElement("div");
  bar.id = "updateBar";
  bar.style.position = "fixed";
  bar.style.left = "12px";
  bar.style.right = "12px";
  bar.style.bottom = "64px";
  bar.style.zIndex = "9999";
  bar.style.padding = "10px 12px";
  bar.style.borderRadius = "14px";
  bar.style.border = "1px solid rgba(255,255,255,.14)";
  bar.style.background = "rgba(17,24,39,.92)";
  bar.style.backdropFilter = "blur(10px)";
  bar.style.display = "flex";
  bar.style.gap = "10px";
  bar.style.alignItems = "center";
  bar.style.justifyContent = "space-between";
  bar.innerHTML = `
    <div style="font-size:12px;color:rgba(229,231,235,.92);line-height:1.2;">
      <b style="color:#fff;">Nueva versión disponible</b><br>
      Actualiza para ver los cambios ✨
    </div>
    <button id="btnUpdateNow" class="btn primary" style="white-space:nowrap;">Actualizar</button>
  `;

  document.body.appendChild(bar);
  bar.querySelector("#btnUpdateNow").addEventListener("click", () => onUpdate?.());
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");

      if (reg.waiting) {
        showUpdateBanner(() => reg.waiting?.postMessage({ type: "SKIP_WAITING" }));
      }

      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;

        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(() => reg.waiting?.postMessage({ type: "SKIP_WAITING" }));
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    } catch {
      // La app igual vive sin SW.
    }
  });
}

/* ---------------------------
   Init
--------------------------- */

DATA = load();
mountBackupButtons();
lastSavedSnapshot = snapshot(DATA);

// Chart.js dark theme defaults
if (typeof window.Chart !== 'undefined') {
  window.Chart.defaults.color = 'rgba(156,163,175,0.85)';
  window.Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
  window.Chart.defaults.font = { family: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', size: 12 };
}

render();