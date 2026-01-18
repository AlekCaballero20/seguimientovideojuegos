/* Game Rotator — v1.3 (localStorage-only)
   Mejoras:
   - Histórico más útil: stats por juego (sesiones, días desde inicio, rachas, gaps).
   - Prioriza juegos nunca jugados y “abandonados” sin matar el peso de consola.
   - Timeline “últimos 7 días” dentro de Plan de hoy (sin tocar HTML).
   - Mensajes dinámicos (cambia según situación).
   - Toasts + micro-animaciones (Web Animations API) sin tocar CSS.
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
  // ISO "YYYY-MM-DD" -> local midnight
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt.getTime();
}

function msToISO(ms) {
  if (!ms) return null;
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
  // floor day diff based on ms
  return Math.max(0, Math.floor((aMs - bMs) / 86400000));
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

function seed() {
  const now = Date.now();
  const data = {
    meta: { createdAt: now, version: "1.3" },
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
        startedAt: null,     // primera vez jugado (ms)
        lastPlayed: null,    // ms
        completedAt: null    // ms
      }
    ],
    history: [], // {date, consoleId, gameId, playedAt?}
    today: null, // {date, consoleId, gameId}
    skips: {}    // { "YYYY-MM-DD": [{consoleId, gameId}, ...] }
  };

  data.games[0].consoleId = data.consoles[0].id;
  return data;
}

// Migración suave (compatible con data vieja)
function migrate(data) {
  if (!data || typeof data !== "object") return seed();
  if (!Array.isArray(data.consoles)) data.consoles = [];
  if (!Array.isArray(data.games)) data.games = [];
  if (!Array.isArray(data.history)) data.history = [];
  if (!data.meta) data.meta = { createdAt: Date.now() };
  if (!data.skips || typeof data.skips !== "object") data.skips = {};
  if (!("today" in data)) data.today = null;

  // Bump versión (sin romper)
  data.meta.version = data.meta.version || "1.1";

  // Normaliza juegos (addedAt, startedAt)
  const now = Date.now();
  for (const g of data.games) {
    if (!("addedAt" in g) || !g.addedAt) g.addedAt = now;
    if (!("startedAt" in g)) g.startedAt = null;
    if (!("lastPlayed" in g)) g.lastPlayed = null;
    if (!("completedAt" in g)) g.completedAt = null;
    if (!("status" in g)) g.status = "active";
  }

  // Normaliza history: agrega playedAt si no existe (derivado del date)
  for (const h of data.history) {
    if (!("playedAt" in h) || !h.playedAt) {
      const ms = isoToMs(h.date);
      h.playedAt = ms || null;
    }
  }

  // Recalcula startedAt si está vacío y hay historial
  hydrateGameDerivedFromHistory(data);

  // Limpieza de “skips” con cosas borradas
  pruneDanglingRefs(data);

  data.meta.version = "1.3";
  return data;
}

function pruneDanglingRefs(data) {
  const gameIds = new Set(data.games.map(g => g.id));
  const consoleIds = new Set(data.consoles.map(c => c.id));

  // history
  data.history = data.history.filter(h => gameIds.has(h.gameId) && consoleIds.has(h.consoleId));

  // today
  if (data.today?.gameId && !gameIds.has(data.today.gameId)) data.today = null;
  if (data.today?.consoleId && !consoleIds.has(data.today.consoleId)) data.today = null;

  // skips
  if (data.skips && typeof data.skips === "object") {
    for (const day of Object.keys(data.skips)) {
      data.skips[day] = (data.skips[day] || []).filter(s => gameIds.has(s.gameId) && consoleIds.has(s.consoleId));
      if (!data.skips[day].length) {
        // deja el día vacío, no molesta, pero puedes limpiarlo si quieres
      }
    }
  }
}

function hydrateGameDerivedFromHistory(data) {
  // Para cada juego: startedAt = primera aparición en history
  const first = new Map(); // gameId -> ms
  for (const h of data.history) {
    if (!h?.gameId || !h?.date) continue;
    const ms = h.playedAt || isoToMs(h.date) || null;
    if (!ms) continue;
    const prev = first.get(h.gameId);
    if (!prev || ms < prev) first.set(h.gameId, ms);
  }

  for (const g of data.games) {
    if (!g.startedAt && first.has(g.id)) g.startedAt = first.get(g.id);
    // Si no tiene lastPlayed pero hay historial, lo sacamos del último
    if (!g.lastPlayed) {
      const last = lastPlayForGame(data, g.id);
      if (last?.playedAt) g.lastPlayed = last.playedAt;
    }
  }
}

function lastPlayForGame(data, gameId) {
  return data.history.slice().reverse().find(h => h.gameId === gameId) || null;
}

function byId(arr, id) {
  return arr.find((x) => x.id === id) || null;
}

function activeGamesForConsole(data, consoleId) {
  return data.games.filter((g) => g.consoleId === consoleId && g.status === "active");
}

function lastAssignmentForDate(data, date) {
  return data.history.slice().reverse().find((h) => h.date === date) || null;
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

/* ---------------------------
   Toast + micro-animaciones (sin CSS)
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

  // Cancel anim previa
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
  elm.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.01)" }, { transform: "scale(1)" }],
    { duration: 240, easing: "ease-out" }
  );
}

function flipSwap(elm) {
  if (!elm) return;
  elm.getAnimations().forEach(a => a.cancel());
  elm.animate(
    [
      { opacity: 0.2, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" }
    ],
    { duration: 220, easing: "ease-out" }
  );
}

/* ---------------------------
   Stats derivadas
--------------------------- */

function uniqueDatesFromHistoryForGame(data, gameId) {
  const set = new Set();
  for (const h of data.history) {
    if (h.gameId === gameId && h.date) set.add(h.date);
  }
  return Array.from(set).sort(); // ISO lex sorts by time
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
  // streak que termina en HOY si jugaste hoy, si no, streak termina en última fecha jugada
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

  const now = Date.now();
  const firstMs = firstDate ? isoToMs(firstDate) : (g?.startedAt || null);
  const lastMs = lastDate ? isoToMs(lastDate) : (g?.lastPlayed || null);

  const daysSinceStart = firstMs ? diffDaysMs(now, firstMs) : null;
  const daysSinceLast = lastMs ? diffDaysMs(now, lastMs) : null;

  const best = longestStreak(dates);
  const cur = currentStreak(dates);
  const avgGap = avgGapDays(dates);

  const addedMs = g?.addedAt || null;
  const daysSinceAdded = addedMs ? diffDaysMs(now, addedMs) : null;

  return {
    sessions,
    firstDate,
    lastDate,
    daysSinceStart,
    daysSinceLast,
    streakBest: best,
    streakCurrent: cur,
    avgGap,
    daysSinceAdded
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

function buildLast7Timeline(data) {
  const days = lastNDaysISO(7);
  const map = new Map();
  for (const h of data.history) map.set(h.date, h); // 1 por día (tú garantizas eso)

  return days.map(date => {
    const h = map.get(date);
    if (!h) return { date, played: false, label: "—" };

    const c = byId(data.consoles, h.consoleId);
    const g = byId(data.games, h.gameId);
    return {
      date,
      played: true,
      label: `${c?.name || "?"} · ${g?.title || "?"}`
    };
  });
}

/* ---------------------------
   Rotation logic (mejorado)
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
  // Lower score = mejor candidato (más “debido”)
  const g = byId(data.games, pair.gameId);
  const c = byId(data.consoles, pair.consoleId);
  if (!g || !c) return 999;

  const now = Date.now();
  let score = 0;

  // 1) Prioridad fuerte a “nunca jugado”
  if (!g.lastPlayed) {
    const daysSinceAdded = g.addedAt ? diffDaysMs(now, g.addedAt) : 0;
    // Más viejo sin jugar = más prioridad
    score -= 22;
    score -= clamp(daysSinceAdded, 0, 10); // hasta -10 extra
  } else {
    const daysAgo = diffDaysMs(now, g.lastPlayed);
    // Más días sin jugar = más prioridad (hasta cierto punto)
    score -= clamp(daysAgo, 0, 18);

    // 2) Si está medio abandonado (ej: >7 días), empujoncito extra
    if (daysAgo >= 7) score -= clamp(daysAgo - 7, 0, 8);
  }

  // 3) Consolas con menos uso reciente (últimos 14 días)
  const recent = data.history.slice(-14);
  const consoleCount = recent.filter((h) => h.consoleId === pair.consoleId).length;
  score += consoleCount * 1.6; // menos agresivo que antes, para no matar “unplayed”

  // 4) Peso consola (más peso => más frecuente => menos penalización)
  const w = Number(c.weight || 1);
  // Convertimos a penalización suave: w alto = menos suma
  score += clamp(1 / Math.max(0.25, w), 0.25, 4) * 0.9;

  // 5) Pequeña penalización a juegos completados (por si algo raro queda active)
  if (g.status !== "active") score += 50;

  return score;
}

function pickToday(data, { forceNew = false } = {}) {
  const t = todayISO();

  if (!data.skips) data.skips = {};
  if (!data.skips[t]) data.skips[t] = [];

  // Reusa pick del día si no forces
  if (!forceNew && data.today && data.today.date === t) return data.today;

  let pairs = buildCandidatePairs(data).filter((p) => {
    const g = byId(data.games, p.gameId);
    return g && g.status === "active";
  });

  if (!pairs.length) {
    data.today = { date: t, consoleId: null, gameId: null };
    return data.today;
  }

  // Evita pares skippeados hoy
  const skipped = data.skips[t];
  pairs = pairs.filter(
    (p) => !skipped.some((s) => s.consoleId === p.consoleId && s.gameId === p.gameId)
  );

  // Si ya skippeaste todo hoy, resetea skips del día
  if (!pairs.length) {
    data.skips[t] = [];
    pairs = buildCandidatePairs(data).filter((p) => {
      const g = byId(data.games, p.gameId);
      return g && g.status === "active";
    });
  }

  // Evita repetir ayer EXACTO si se puede
  const y = yesterdayISO();
  const yPick = lastAssignmentForDate(data, y);
  if (yPick) {
    const notYesterday = pairs.filter(
      (p) => !(p.consoleId === yPick.consoleId && p.gameId === yPick.gameId)
    );
    if (notYesterday.length) pairs = notYesterday;
  }

  // Score y elige mejor
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
  // hash simple estable por día
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
   UI render (mejorado)
--------------------------- */

function renderTodayBox(data) {
  const t = todayISO();
  const today = data.today;

  if (!today || !today.consoleId || !today.gameId) {
    todayBox.innerHTML = `
      <div class="kv">
        <span class="pill">No hay plan todavía 😶</span>
      </div>
      <p class="hint">Agrega consolas y pon 1-2 juegos activos por consola para que el rotador funcione.</p>
    `;
    return;
  }

  const c = byId(data.consoles, today.consoleId);
  const g = byId(data.games, today.gameId);
  const skippedCount = (data.skips?.[t]?.length || 0);
  const stats = computeGameStats(data, today.gameId);

  const lastPlayedStr = g?.lastPlayed
    ? `${new Date(g.lastPlayed).toLocaleString("es-CO")}`
    : "Nunca";

  const sinceStart =
    stats.daysSinceStart != null ? `${stats.daysSinceStart} día(s) desde que lo empezaste` : "Aún no lo has empezado";

  const sinceLast =
    stats.daysSinceLast != null ? `· ${stats.daysSinceLast} día(s) desde la última vez` : "";

  const sessions =
    stats.sessions ? `· ${stats.sessions} sesión(es)` : `· 0 sesiones`;

  const streak =
    stats.sessions ? `· Racha máx: ${stats.streakBest}` : "";

  // Timeline 7 días
  const timeline = buildLast7Timeline(data)
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

  todayBox.innerHTML = `
    <div class="kv">
      <span class="pill">Consola: <b>${escapeHtml(c?.name || "—")}</b></span>
      <span class="pill">Juego: <b>${escapeHtml(g?.title || "—")}</b></span>
      <span class="pill">Estado: <b>${g?.status === "active" ? "Por pasar" : "—"}</b></span>
    </div>

    <div class="subhint">
      Última vez jugado: ${lastPlayedStr}
      ${sessions}
      ${sinceLast}
      ${streak}
      ${skippedCount ? ` · Cambios hoy: ${skippedCount}` : ``}
    </div>

    <div class="subhint">⏳ ${sinceStart}</div>

    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">
      <div class="subhint" style="margin:0 0 6px;">Últimos 7 días</div>
      <div>${timeline}</div>
    </div>
  `;

  // Click en Plan de hoy => Stats del juego (comodín)
  todayBox.onclick = () => openStatsModal(today.gameId);
}

function renderConsoles(data) {
  consolesList.innerHTML = "";
  for (const c of data.consoles) {
    const activeCount = activeGamesForConsole(data, c.id).length;
    const last = data.history.slice().reverse().find((h) => h.consoleId === c.id);
    const lastStr = last ? last.date : "—";

    consolesList.appendChild(
      el(`
        <div class="item">
          <div class="meta">
            <div class="title">${escapeHtml(c.name)}</div>
            <div class="sub">Activos: ${activeCount}/2 · Último uso: ${escapeHtml(lastStr)}</div>
          </div>
          <div class="mini">
            <span class="badge">peso: ${Number(c.weight || 1)}</span>
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

  // Toolbar mini (sin tocar HTML)
  const toolbar = el(`
    <div class="item" style="align-items:center;">
      <div class="meta" style="width:100%;">
        <div class="title">Explorar juegos</div>
        <div class="sub">Filtra y revisa stats rápido. (Sí, ahora esto es serio.)</div>
      </div>
      <div class="mini" style="gap:10px;">
        <input id="qGames" placeholder="Buscar..." 
          style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#e5e7eb;min-width:180px;outline:none;" />
        <select id="filterGames"
          style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#e5e7eb;outline:none;">
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

  // estado de filtro en memoria (no en data, solo UI)
  const ui = window.__rotUI || (window.__rotUI = { q: "", f: "all" });
  $q.value = ui.q;
  $f.value = ui.f;

  const apply = () => {
    ui.q = $q.value.trim().toLowerCase();
    ui.f = $f.value;
    render(); // re-render completo (simple y suficiente para tamaño pequeño)
  };

  $q.oninput = () => apply();
  $f.onchange = () => apply();

  // Filtrado
  let list = data.games.slice();

  if (ui.q) {
    list = list.filter(g => (g.title || "").toLowerCase().includes(ui.q));
  }

  if (ui.f === "active") list = list.filter(g => g.status === "active");
  if (ui.f === "done") list = list.filter(g => g.status === "done");
  if (ui.f === "unplayed") list = list.filter(g => !g.lastPlayed && g.status === "active");

  // Orden “inteligente”: unplayed primero, luego más días sin jugar
  list.sort((a, b) => {
    const au = !a.lastPlayed ? 1 : 0;
    const bu = !b.lastPlayed ? 1 : 0;
    if (au !== bu) return bu - au; // unplayed arriba

    const ad = a.lastPlayed ? diffDaysMs(Date.now(), a.lastPlayed) : 999;
    const bd = b.lastPlayed ? diffDaysMs(Date.now(), b.lastPlayed) : 999;
    return bd - ad;
  });

  for (const g of list) {
    const c = byId(data.consoles, g.consoleId);
    const statusLabel = g.status === "active" ? "Por pasar" : "Completado";
    const stats = computeGameStats(data, g.id);

    const extra = g.status === "active"
      ? (!g.lastPlayed ? "· Nunca jugado 👀" : `· Hace ${stats.daysSinceLast ?? "?"} día(s)`)
      : (g.completedAt ? `· ${new Date(g.completedAt).toLocaleDateString("es-CO")}` : "");

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
          </div>
          <div class="mini">
            <span class="badge">${statusLabel}</span>
            <button class="btn ghost" data-action="statsGame" data-id="${g.id}">📊 Stats</button>
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

  // micro anim a items nuevos
  Array.from(gamesList.querySelectorAll(".item")).slice(1).forEach((node, i) => {
    node.animate(
      [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 160 + i * 12, easing: "ease-out" }
    );
  });
}

function updateMainHint(data) {
  // El hint fijo está en la primera card (Plan de hoy)
  const hint = document.querySelector(".card .hint");
  if (!hint) return;

  const msg = buildDailyMessage(data, data.today);
  hint.textContent = msg;
}

function render() {
  const data = load();
  const t = todayISO();
  todayTag.textContent = `Hoy: ${t}`;

  // Ensure today suggestion exists
  pickToday(data);
  save(data);

  renderTodayBox(data);
  renderConsoles(data);
  renderGames(data);
  updateMainHint(data);
}

/* ---------------------------
   Modal helpers
--------------------------- */

async function openModal({ title, bodyHtml, onOk }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;

  const result = await new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue), { once: true });
    modal.showModal();
  });

  if (result !== "ok") return;
  await onOk();
}

async function openStatsModal(gameId) {
  const data = load();
  const g = byId(data.games, gameId);
  if (!g) return;

  const c = byId(data.consoles, g.consoleId);
  const s = computeGameStats(data, gameId);

  const dates = uniqueDatesFromHistoryForGame(data, gameId);
  const last10 = dates.slice(-10).reverse();

  const avgGap = s.avgGap != null ? `${s.avgGap.toFixed(1)} días` : "—";
  const sinceStart = s.daysSinceStart != null ? `${s.daysSinceStart} día(s)` : "—";
  const sinceLast = s.daysSinceLast != null ? `${s.daysSinceLast} día(s)` : "—";

  const body = `
    <div class="subhint" style="margin-bottom:10px;">
      <b>${escapeHtml(g.title)}</b> · ${escapeHtml(c?.name || "Sin consola")} · ${g.status === "active" ? "Por pasar" : "Completado"}
    </div>

    <div class="kv" style="gap:8px;">
      <span class="pill">Sesiones: <b>${s.sessions}</b></span>
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
    onOk: async () => {
      // Modal es “dialog method=dialog”: OK no hace nada, pero lo dejamos para UX consistente
    }
  });
}

/* ---------------------------
   Actions
--------------------------- */

btnAddConsole.addEventListener("click", async () => {
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
      const data = load();
      const name = $("#cName").value.trim();
      const weight = Number($("#cWeight").value || 1);
      if (!name) return;

      data.consoles.push({ id: uid("c"), name, weight: isFinite(weight) ? weight : 1 });
      data.today = null;
      save(data);
      render();
      toast("Consola agregada ✅");
    }
  });
});

btnAddGame.addEventListener("click", async () => {
  const data = load();
  if (!data.consoles.length) {
    toast("Primero agrega al menos una consola 😌");
    return;
  }

  const options = data.consoles
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
      const d = load();
      const title = $("#gTitle").value.trim();
      const consoleId = $("#gConsole").value;
      const status = $("#gStatus").value;

      if (!title || !consoleId) return;

      // Rule: max 2 active per console
      if (status === "active") {
        const act = activeGamesForConsole(d, consoleId);
        if (act.length >= 2) {
          toast("Esa consola ya tiene 2 juegos activos. Completa uno primero. 😌");
          return;
        }
      }

      d.games.push({
        id: uid("g"),
        consoleId,
        title,
        status,
        addedAt: Date.now(),
        startedAt: null,
        lastPlayed: null,
        completedAt: status === "done" ? Date.now() : null
      });

      d.today = null;
      save(d);
      render();
      toast(status === "active" ? "Juego agregado (por pasar) ✅" : "Juego agregado (completado) ✅");
    }
  });
});

btnPlayed.addEventListener("click", () => {
  const data = load();
  pickToday(data);

  const t = todayISO();
  const today = data.today;

  if (!today?.consoleId || !today?.gameId) {
    toast("No hay plan para marcar. Agrega consolas/juegos primero.");
    return;
  }

  // Save history (1 per day)
  data.history = data.history.filter((h) => h.date !== t);
  data.history.push({
    date: t,
    consoleId: today.consoleId,
    gameId: today.gameId,
    playedAt: Date.now()
  });

  // Update game fields
  const g = byId(data.games, today.gameId);
  if (g) {
    g.lastPlayed = Date.now();
    if (!g.startedAt) g.startedAt = g.lastPlayed; // “empezado” = primera sesión
  }

  save(data);
  render();

  pulse(todayBox);

  // mini logros suaves
  const last7 = buildLast7Timeline(data);
  const uniqueGames7 = new Set(
    data.history
      .filter(h => lastNDaysISO(7).includes(h.date))
      .map(h => h.gameId)
  ).size;

  const msg = uniqueGames7 >= 3
    ? `Jugaste hoy ✅ y esta semana llevas ${uniqueGames7} juegos distintos. Respeto. 🏆`
    : "Marcado ✅ mañana evitamos repetirte lo mismo.";

  toast(msg);
});

btnSwap.addEventListener("click", () => {
  const data = load();
  const t = todayISO();

  pickToday(data);

  if (!data.skips) data.skips = {};
  if (!data.skips[t]) data.skips[t] = [];

  if (data.today?.consoleId && data.today?.gameId) {
    data.skips[t].push({ consoleId: data.today.consoleId, gameId: data.today.gameId });
  }

  pickToday(data, { forceNew: true });
  save(data);
  render();

  flipSwap(todayBox);

  const n = data.skips[t]?.length || 0;
  toast(n >= 3 ? `Cambio #${n}. Tú sí eres indeciso(a). 😌` : "Sugerencia cambiada 🔄");
});

btnComplete.addEventListener("click", () => {
  const data = load();
  pickToday(data);
  const today = data.today;

  if (!today?.gameId) {
    toast("No hay juego para completar.");
    return;
  }

  const g = byId(data.games, today.gameId);
  if (!g) return;

  g.status = "done";
  g.completedAt = Date.now();

  data.today = null;
  save(data);
  render();

  pulse(todayBox);
  toast("Juego marcado como completado 🏁");
});

btnReset.addEventListener("click", () => {
  const data = load();
  const t = todayISO();

  data.today = null;
  if (data.skips && data.skips[t]) data.skips[t] = [];

  save(data);
  render();

  toast("Plan de hoy reseteado. Volvemos a girar la ruleta. 🎲");
});

document.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const data = load();

  if (action === "statsGame") {
    await openStatsModal(id);
    return;
  }

  if (action === "delConsole") {
    const ok = confirm("¿Borrar consola? Esto no borra juegos, pero quedarán ‘sin consola’.");
    if (!ok) return;

    data.consoles = data.consoles.filter((c) => c.id !== id);
    for (const g of data.games) {
      if (g.consoleId === id) g.consoleId = null;
    }

    data.today = null;
    pruneDanglingRefs(data);
    save(data);
    render();
    toast("Consola borrada 🗑️");
  }

  if (action === "editConsole") {
    const c = byId(data.consoles, id);
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
          <input id="cWeight" type="number" step="0.25" value="${Number(c.weight || 1)}" />
        </div>
      `,
      onOk: () => {
        const d = load();
        const cc = byId(d.consoles, id);
        if (!cc) return;

        const name = $("#cName").value.trim();
        const weight = Number($("#cWeight").value || 1);

        if (name) cc.name = name;
        cc.weight = isFinite(weight) ? weight : 1;

        d.today = null;
        save(d);
        render();
        toast("Consola actualizada ✅");
      }
    });
  }

  if (action === "delGame") {
    const ok = confirm("¿Borrar juego? Se va para el vacío eterno.");
    if (!ok) return;

    data.games = data.games.filter((g) => g.id !== id);
    data.history = data.history.filter((h) => h.gameId !== id);

    if (data.today?.gameId === id) data.today = null;

    if (data.skips) {
      for (const day of Object.keys(data.skips)) {
        data.skips[day] = (data.skips[day] || []).filter((s) => s.gameId !== id);
      }
    }

    pruneDanglingRefs(data);
    save(data);
    render();
    toast("Juego borrado 🗑️");
  }

  if (action === "editGame") {
    const g = byId(data.games, id);
    if (!g) return;

    const options = data.consoles
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
      `,
      onOk: () => {
        const d = load();
        const gg = byId(d.games, id);
        if (!gg) return;

        const title = $("#gTitle").value.trim();
        const consoleId = $("#gConsole").value;
        const status = $("#gStatus").value;

        if (title) gg.title = title;

        // If switching to active, validate rule 2 active per console
        if (status === "active") {
          const act = activeGamesForConsole(d, consoleId).filter((x) => x.id !== gg.id);
          if (act.length >= 2) {
            toast("Esa consola ya tiene 2 juegos activos. Completa uno primero.");
            return;
          }
          gg.completedAt = null;
        } else {
          gg.completedAt = Date.now();
        }

        gg.consoleId = consoleId;
        gg.status = status;

        d.today = null;
        save(d);
        render();
        toast("Juego actualizado ✅");
      }
    });
  }

  if (action === "toggleGame") {
    const g = byId(data.games, id);
    if (!g) return;

    if (g.status === "active") {
      g.status = "done";
      g.completedAt = Date.now();
      toast("Marcado como completado 🏁");
    } else {
      const act = activeGamesForConsole(data, g.consoleId);
      if (act.length >= 2) {
        toast("Esa consola ya tiene 2 juegos activos. No se puede reactivar.");
        return;
      }
      g.status = "active";
      g.completedAt = null;
      toast("Reactivado ✅");
    }

    data.today = null;
    save(data);
    render();
  }
});

/* ---------------------------
   PWA install + SW
--------------------------- */

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.hidden = true;
});

function showUpdateBanner(onUpdate) {
  // banner simple sin tocar tu HTML
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

      // Si hay un SW nuevo esperando, avisa de una
      if (reg.waiting) {
        showUpdateBanner(() => {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        });
      }

      // Cuando se encuentre un update
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;

        sw.addEventListener("statechange", () => {
          // installed + ya había controller => update real (no primera instalación)
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(() => {
              reg.waiting?.postMessage({ type: "SKIP_WAITING" });
            });
          }
        });
      });

      // Cuando el nuevo SW tome control, recargamos para servir assets nuevos
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });

    } catch {
      // silencio, la app igual funciona online sin SW
    }
  });
}


/* ---------------------------
   Init
--------------------------- */
render();
