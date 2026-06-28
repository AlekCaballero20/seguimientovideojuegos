import { ALLOWED_EMAIL, isAllowedUser, watchAuth, loginWithGoogle, logout } from "./firebase/auth.service.js";
import { watchUserData, upsertItem, deleteAllUserData } from "./firebase/firestore.service.js";
import { ensureDefaultConsoles, saveConsole, deleteConsole } from "./services/consoles.service.js";
import { saveGame, updateGame, deleteGame, mainGamesForConsole, gameAverageRating } from "./services/games.service.js";
import { registerSession } from "./services/sessions.service.js";
import { buildStats } from "./services/stats.service.js";
import { pickGame, saveTodayPlan, getTodayPlan } from "./services/rotation.service.js";
import { migrateLegacyToFirestore, hasLegacyData, importBackupToFirestore } from "./services/migration.service.js";
import { CATEGORIES, CATEGORY_META } from "./utils/constants.js";
import { todayISO, humanDate, relativeDay } from "./utils/dates.js";
import { escapeHtml, minutesLabel, percent, categoryBadge, stars, downloadJson, readFileAsJson } from "./utils/formatters.js";
import { createModalApi } from "./ui/modals.js";
import { setupNavigation, setActiveView } from "./ui/navigation.js";
import { renderDoughnut } from "./ui/charts.js";

const state = {
  user: null,
  uid: null,
  view: "today",
  filter: "all",
  search: "",
  sort: "alphabetical",
  data: { consoles: [], games: [], sessions: [], dailyPlans: [] },
  unsubscribeData: null,
  seededDefaults: false,
  ensuringPlan: false,
  lastRotatorGame: null
};

const modal = createModalApi();

const els = {
  authGate: document.querySelector("#authGate"),
  appShell: document.querySelector("#appShell"),
  btnLogin: document.querySelector("#btnLogin"),
  btnLogout: document.querySelector("#btnLogout"),
  btnInstall: document.querySelector("#btnInstall"),
  userName: document.querySelector("#userName"),
  syncState: document.querySelector("#syncState"),
  todayDate: document.querySelector("#todayDate"),
  todayRecommendation: document.querySelector("#todayRecommendation"),
  focusByConsole: document.querySelector("#focusByConsole"),
  recentSessions: document.querySelector("#recentSessions"),
  categoryFilters: document.querySelector("#categoryFilters"),
  gameSearch: document.querySelector("#gameSearch"),
  gameSort: document.querySelector("#gameSort"),
  gamesGrid: document.querySelector("#gamesGrid"),
  consolesList: document.querySelector("#consolesList"),
  statsKpis: document.querySelector("#statsKpis"),
  curiosityStats: document.querySelector("#curiosityStats"),
  historyList: document.querySelector("#historyList"),
  rotatorResult: document.querySelector("#rotatorResult"),
  toastHost: document.querySelector("#toastHost"),
  backupInput: document.querySelector("#backupInput")
};

function $(selector) { return document.querySelector(selector); }

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  els.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function setSync(text, ok = false) {
  els.syncState.textContent = text;
  els.syncState.classList.toggle("ok", ok);
}

function consoleById(id) {
  return state.data.consoles.find((consoleItem) => consoleItem.id === id) || null;
}

function gameById(id) {
  return state.data.games.find((game) => game.id === id) || null;
}

function sessionsForGame(gameId) {
  return state.data.sessions.filter((session) => session.gameId === gameId);
}

function sortedSessions(limit = null) {
  const list = state.data.sessions.slice().sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  return limit ? list.slice(0, limit) : list;
}

function playableGames() {
  return state.data.games.filter((game) => !["wishlist", "completed"].includes(game.category));
}

function averageRatingFromSessions(gameId) {
  const ratings = sessionsForGame(gameId).map((s) => Number(s.rating)).filter(Boolean);
  if (!ratings.length) return 0;
  return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
}

function categoryLabel(category) {
  return CATEGORY_META[category]?.label || "Secundario";
}

function gameCardClass(game) {
  return CATEGORY_META[game.category]?.className || "category-secondary";
}

function normalizeData(data) {
  return {
    consoles: (data.consoles || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
    games: (data.games || []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title))),
    sessions: (data.sessions || []).slice(),
    dailyPlans: (data.dailyPlans || []).slice()
  };
}

async function maybeEnsureDefaultsAndPlan() {
  if (!state.uid) return;

  if (!state.seededDefaults && state.data.consoles.length === 0) {
    state.seededDefaults = true;
    await ensureDefaultConsoles(state.uid, state.data.consoles);
    return;
  }

  if (state.ensuringPlan) return;
  const existing = getTodayPlan(state.data);
  const existingGame = existing ? gameById(existing.gameId) : null;
  if ((existing && existingGame?.rotationEnabled !== false) || !state.data.games.length || !state.data.consoles.length) return;

  const suggestion = pickGame(state.data, { includeSecondary: true, avoidRecent: true });
  if (!suggestion) return;
  state.ensuringPlan = true;
  try { await saveTodayPlan(state.uid, suggestion, "auto"); }
  finally { state.ensuringPlan = false; }
}

function renderAll() {
  els.todayDate.textContent = humanDate(todayISO());
  renderCategoryFilters();
  renderToday();
  renderFocusByConsole();
  renderRecentSessions();
  renderGames();
  renderConsoles();
  renderStats();
}

function renderCategoryFilters() {
  els.categoryFilters.innerHTML = CATEGORIES.map((category) => `
    <button class="chip ${state.filter === category.id ? "active" : ""}" type="button" data-filter="${category.id}">
      ${category.icon} ${category.label}
    </button>
  `).join("");
}

function renderToday() {
  const plan = getTodayPlan(state.data);
  const plannedGame = plan ? gameById(plan.gameId) : null;
  const game = plannedGame && plannedGame.rotationEnabled !== false ? plannedGame : pickGame(state.data, { includeSecondary: true, avoidRecent: true });
  const consoleItem = game ? consoleById(game.consoleId) : null;

  if (!game) {
    els.todayRecommendation.className = "hero-card";
    els.todayRecommendation.innerHTML = `
      <div class="hero-main">
        <p class="eyebrow">Sin sugerencia</p>
        <h3>Agrega juegos para empezar</h3>
        <p class="muted">La app no puede rotar la nada, aunque sería muy filosófico.</p>
      </div>
      <div class="hero-actions">
        <button class="btn primary" type="button" data-action="add-game">+ Agregar juego</button>
        <button class="btn" type="button" data-nav="settings">Consolas</button>
      </div>
    `;
    return;
  }

  const progress = percent(game.progress);
  els.todayRecommendation.className = `hero-card ${gameCardClass(game)}`;
  els.todayRecommendation.innerHTML = `
    <div class="hero-main">
      <div class="hero-top">
        <div>
          <p class="eyebrow">Juego recomendado</p>
          <h3>${escapeHtml(game.title)}</h3>
        </div>
        ${categoryBadge(game.category)}
      </div>
      <div class="hero-meta">
        <span class="mini-pill">${escapeHtml(consoleItem?.icon || "🎮")} ${escapeHtml(consoleItem?.name || "Sin consola")}</span>
        <span class="mini-pill">${relativeDay(game.lastPlayed)}</span>
        <span class="mini-pill">${minutesLabel(game.totalMinutes || 0)}</span>
      </div>
      <div class="progress-wrap">
        ${game.genre ? `<div class="game-meta"><span class="mini-pill">🎭 ${escapeHtml(game.genre)}</span></div>` : ""}
        <div class="progress-label"><span>Progreso</span><strong>${progress}%</strong></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn primary" type="button" data-action="play" data-id="${game.id}">✅ Registrar sesión</button>
      <button class="btn" type="button" data-action="game-stats" data-id="${game.id}">📊 Ver juego</button>
      <button class="btn" type="button" data-action="edit-game" data-id="${game.id}">✏️ Editar</button>
      <button class="btn danger" type="button" data-action="complete-game" data-id="${game.id}">🏁 Completar</button>
    </div>
  `;
}

function renderFocusByConsole() {
  if (!state.data.consoles.length) {
    els.focusByConsole.innerHTML = `<div class="empty-state">Aún no hay consolas. El drama empieza con una PS5, una Switch o lo que tengas a mano.</div>`;
    return;
  }

  els.focusByConsole.innerHTML = state.data.consoles.map((consoleItem) => {
    const mains = state.data.games.filter((game) => game.consoleId === consoleItem.id && game.category === "main");
    const slots = [0, 1].map((index) => mains[index]).filter(Boolean);
    const emptySlots = 2 - slots.length;
    return `
      <article class="console-focus-card">
        <div class="console-focus-head">
          <div>
            <strong>${escapeHtml(consoleItem.icon || "🎮")} ${escapeHtml(consoleItem.name)}</strong>
            <p class="tiny">${mains.length}/2 principales</p>
          </div>
          <button class="text-btn" type="button" data-action="add-main-for-console" data-id="${consoleItem.id}">+ Principal</button>
        </div>
        <div class="focus-games">
          ${slots.map((game) => `
            <div class="focus-game">
              <span>${escapeHtml(game.title)}</span>
              <button class="text-btn" type="button" data-action="play" data-id="${game.id}">Jugar</button>
            </div>
          `).join("")}
          ${Array.from({ length: Math.max(0, emptySlots) }).map(() => `
            <div class="focus-game">
              <span class="muted">Slot libre</span>
              <span class="muted">🎯</span>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderRecentSessions() {
  const sessions = sortedSessions(6);
  if (!sessions.length) {
    els.recentSessions.innerHTML = `<div class="empty-state">Todavía no hay sesiones. Algún día el historial juzgará tus decisiones, pero hoy no.</div>`;
    return;
  }
  els.recentSessions.innerHTML = sessions.map(sessionRowHtml).join("");
}

function sessionRowHtml(session) {
  const game = gameById(session.gameId);
  const consoleItem = consoleById(session.consoleId);
  return `
    <article class="session-row">
      <div class="top-line">
        <strong>${escapeHtml(game?.title || "Juego borrado")}</strong>
        <span class="mini-pill">${minutesLabel(session.duration || 0)}</span>
      </div>
      <p>${escapeHtml(consoleItem?.name || "Sin consola")} · ${humanDate(session.playedAt || session.date)} · ${categoryLabel(session.categoryAtPlay || game?.category)}</p>
      ${session.note ? `<p>“${escapeHtml(session.note)}”</p>` : ""}
    </article>
  `;
}

function renderGames() {
  const q = state.search.trim().toLowerCase();
  let games = state.data.games.slice();

  if (state.filter !== "all") games = games.filter((game) => game.category === state.filter);
  if (q) {
    games = games.filter((game) => {
      const consoleItem = consoleById(game.consoleId);
      return [game.title, game.genre, game.notes, consoleItem?.name, categoryLabel(game.category)].some((text) => String(text || "").toLowerCase().includes(q));
    });
  }
  const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), "es", { sensitivity: "base" });
  games.sort((a, b) => {
    if (state.sort === "last-played-oldest") return Number(Boolean(a.lastPlayed)) - Number(Boolean(b.lastPlayed)) || (a.lastPlayed || 0) - (b.lastPlayed || 0) || byTitle(a, b);
    if (state.sort === "last-played-newest") return (b.lastPlayed || 0) - (a.lastPlayed || 0) || byTitle(a, b);
    if (state.sort === "genre") return String(a.genre || "Sin género").localeCompare(String(b.genre || "Sin género"), "es", { sensitivity: "base" }) || byTitle(a, b);
    if (state.sort === "added-newest") return (b.addedAt || 0) - (a.addedAt || 0) || byTitle(a, b);
    return byTitle(a, b);
  });

  if (!games.length) {
    els.gamesGrid.innerHTML = `<div class="empty-state">No hay juegos con ese filtro. Lo sé, una tragedia administrativa.</div>`;
    return;
  }

  els.gamesGrid.innerHTML = games.map((game) => gameCardHtml(game)).join("");
}

function gameCardHtml(game) {
  const consoleItem = consoleById(game.consoleId);
  const progress = percent(game.progress);
  const avg = averageRatingFromSessions(game.id) || gameAverageRating(game);
  return `
    <article class="game-card ${gameCardClass(game)}">
      <div class="game-card-head">
        <div>
          <h3 class="game-title">${escapeHtml(game.title)}</h3>
          <div class="game-meta">
            ${categoryBadge(game.category)}
            <span class="mini-pill">${escapeHtml(consoleItem?.icon || "🎮")} ${escapeHtml(consoleItem?.name || "Sin consola")}</span>
          </div>
        </div>
        <button class="icon-btn" type="button" data-action="edit-game" data-id="${game.id}" title="Editar">✏️</button>
      </div>
      <div class="progress-wrap">
        ${game.genre ? `<div class="game-meta"><span class="mini-pill">🎭 ${escapeHtml(game.genre)}</span></div>` : ""}
        <div class="progress-label"><span>Progreso</span><strong>${progress}%</strong></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <div class="game-stats">
        <div class="stat-mini"><span>Tiempo</span><strong>${minutesLabel(game.totalMinutes || 0)}</strong></div>
        <div class="stat-mini"><span>Última vez</span><strong>${relativeDay(game.lastPlayed)}</strong></div>
        <div class="stat-mini"><span>Rating</span><strong>${stars(avg)}</strong></div>
      </div>
      <div class="card-actions">
        <button class="btn primary" type="button" data-action="play" data-id="${game.id}">Jugar</button>
        <button class="btn" type="button" data-action="change-category" data-id="${game.id}">Categoría</button>
        <button class="btn" type="button" data-action="toggle-rotation" data-id="${game.id}">${game.rotationEnabled === false ? "Habilitar rotación" : "Inhabilitar rotación"}</button>
        <button class="btn" type="button" data-action="game-stats" data-id="${game.id}">Stats</button>
      </div>
    </article>
  `;
}

function renderConsoles() {
  if (!state.data.consoles.length) {
    els.consolesList.innerHTML = `<div class="empty-state">No hay consolas.</div>`;
    return;
  }
  els.consolesList.innerHTML = state.data.consoles.map((consoleItem) => {
    const total = state.data.games.filter((game) => game.consoleId === consoleItem.id).length;
    const mains = state.data.games.filter((game) => game.consoleId === consoleItem.id && game.category === "main").length;
    return `
      <article class="console-row">
        <div class="row-between">
          <div>
            <strong>${escapeHtml(consoleItem.icon || "🎮")} ${escapeHtml(consoleItem.name)}</strong>
            <p class="tiny">${total} juegos · ${mains}/2 principales · peso ${consoleItem.weight || 1}</p>
          </div>
          <div class="header-actions">
            <button class="icon-btn" type="button" data-action="edit-console" data-id="${consoleItem.id}">✏️</button>
            <button class="icon-btn" type="button" data-action="delete-console" data-id="${consoleItem.id}">🗑️</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderStats() {
  const stats = buildStats(state.data);
  els.statsKpis.innerHTML = `
    <article class="kpi-card"><span>Total jugado</span><strong>${minutesLabel(stats.totalMinutes)}</strong></article>
    <article class="kpi-card"><span>Esta semana</span><strong>${minutesLabel(stats.weekMinutes)}</strong></article>
    <article class="kpi-card"><span>Completados</span><strong>${stats.completedCount}</strong></article>
    <article class="kpi-card"><span>Curiosidad</span><strong>${minutesLabel(stats.curiosity.minutes)}</strong></article>
  `;

  const categoryLabels = Object.keys(stats.byCategory).map(categoryLabel);
  const categoryValues = Object.values(stats.byCategory);
  renderDoughnut("categoryChart", categoryLabels.length ? categoryLabels : ["Sin datos"], categoryValues.length ? categoryValues : [0]);

  const consoleLabels = Object.keys(stats.byConsole);
  const consoleValues = Object.values(stats.byConsole);
  renderDoughnut("consoleChart", consoleLabels.length ? consoleLabels : ["Sin datos"], consoleValues.length ? consoleValues : [0]);

  renderCuriosityStats(stats);
  const sessions = sortedSessions();
  els.historyList.innerHTML = sessions.length ? sessions.map(sessionRowHtml).join("") : `<div class="empty-state">No hay histórico todavía.</div>`;
}

function renderCuriosityStats(stats) {
  const repeated = stats.curiosity.repeated;
  const rows = [
    `<article class="insight-row"><strong>${stats.curiosity.games} juegos probados por curiosidad</strong><span class="muted">${stats.curiosity.sessions} sesiones · ${minutesLabel(stats.curiosity.minutes)} registrados</span></article>`
  ];

  if (repeated.length) {
    rows.push(...repeated.slice(0, 4).map((game) => `
      <article class="insight-row">
        <strong>${escapeHtml(game.title)} ya no parece solo curiosidad</strong>
        <span class="muted">Lleva ${game.sessionsCount || 0} sesiones y ${minutesLabel(game.totalMinutes || 0)}. El autoengaño está muy bien documentado.</span>
        <div style="margin-top:10px">
          <button class="btn" type="button" data-action="promote-secondary" data-id="${game.id}">Subir a secundario</button>
        </div>
      </article>
    `));
  } else {
    rows.push(`<article class="insight-row"><strong>Sin curiosidades repetidas</strong><span class="muted">Cuando un antojo se repita, aparecerá aquí para que lo asciendas o lo mires con vergüenza.</span></article>`);
  }
  els.curiosityStats.innerHTML = rows.join("");
}

function openConsoleForm(consoleItem = {}) {
  modal.open({
    modalTitle: consoleItem.id ? "Editar consola" : "Nueva consola",
    modalEyebrow: "Consola",
    html: `
      <div class="form-grid">
        <div class="field"><label>Nombre</label><input name="name" required value="${escapeHtml(consoleItem.name || "")}" placeholder="PS5" /></div>
        <div class="field"><label>Icono</label><input name="icon" value="${escapeHtml(consoleItem.icon || "🎮")}" /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Color</label><input name="color" type="color" value="${escapeHtml(consoleItem.color || "#55b6ff")}" /></div>
        <div class="field"><label>Peso en rotación</label><input name="weight" type="number" min="0.2" max="5" step="0.1" value="${escapeHtml(consoleItem.weight || 1)}" /></div>
      </div>
    `,
    onSubmit: async (values) => {
      await saveConsole(state.uid, { ...consoleItem, ...values });
      toast("Consola guardada.");
    }
  });
}

function gameFormHtml(game = {}, defaults = {}) {
  const current = { category: "secondary", progress: 0, priority: 3, estimatedMinutes: 60, rotationEnabled: true, allowInRotation: false, ...defaults, ...game };
  const consoleOptions = state.data.consoles.map((consoleItem) => `
    <option value="${consoleItem.id}" ${current.consoleId === consoleItem.id ? "selected" : ""}>${escapeHtml(consoleItem.name)}</option>
  `).join("");
  const categoryOptions = Object.entries(CATEGORY_META).map(([id, meta]) => `
    <option value="${id}" ${current.category === id ? "selected" : ""}>${meta.icon} ${meta.label}</option>
  `).join("");

  return `
    <div class="field"><label>Título</label><input name="title" required value="${escapeHtml(current.title || "")}" placeholder="Hogwarts Legacy" /></div>
    <div class="form-grid">
      <div class="field"><label>Consola</label><select name="consoleId" required>${consoleOptions}</select></div>
      <div class="field"><label>Categoría</label><select name="category">${categoryOptions}</select></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Progreso %</label><input name="progress" type="number" min="0" max="100" value="${escapeHtml(current.progress || 0)}" /></div>
      <div class="field"><label>Duración estimada min</label><input name="estimatedMinutes" type="number" min="10" value="${escapeHtml(current.estimatedMinutes || 60)}" /></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Prioridad 1-5</label><input name="priority" type="number" min="1" max="5" value="${escapeHtml(current.priority || 3)}" /></div>
      <div class="field"><label>Género</label><input name="genre" value="${escapeHtml(current.genre || "")}" placeholder="Aventura, RPG, carreras..." /></div>
    </div>
    <div class="field"><label>Tags de mood</label><input name="moodTags" value="${escapeHtml((current.moodTags || []).join?.(", ") || current.moodTags || "")}" placeholder="chill, historia, reto" /></div>
    <label class="field" style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:10px">
      <input name="rotationEnabled" type="checkbox" ${current.rotationEnabled !== false ? "checked" : ""} />
      <span>Tener en cuenta este juego en la rotación</span>
    </label>
    <label class="field" style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:10px">
      <input name="allowInRotation" type="checkbox" ${current.allowInRotation || current.category === "main" ? "checked" : ""} />
      <span>Permitir en rotación si es secundario</span>
    </label>
    <div class="field"><label>Notas</label><textarea name="notes" placeholder="Lo que quieras recordar de este juego.">${escapeHtml(current.notes || "")}</textarea></div>
  `;
}

function openGameForm(game = {}, defaults = {}) {
  if (!state.data.consoles.length) {
    toast("Primero agrega una consola. Sí, los juegos necesitan dónde vivir.");
    openConsoleForm();
    return;
  }

  modal.open({
    modalTitle: game.id ? "Editar juego" : "Nuevo juego",
    modalEyebrow: "Biblioteca",
    html: gameFormHtml(game, defaults),
    onSubmit: async (values) => {
      const prepared = {
        ...game,
        ...values,
        progress: Number(values.progress) || 0,
        priority: Number(values.priority) || 3,
        estimatedMinutes: Number(values.estimatedMinutes) || 60,
        rotationEnabled: values.rotationEnabled === "on",
        allowInRotation: values.allowInRotation === "on"
      };
      await submitGameWithLimit(prepared);
    }
  });
}

async function submitGameWithLimit(preparedGame) {
  const existingMain = mainGamesForConsole(state.data.games, preparedGame.consoleId, preparedGame.id);
  if (preparedGame.category === "main" && existingMain.length >= 2) {
    setTimeout(() => openDemoteModal(preparedGame, existingMain), 80);
    return;
  }
  await saveGame(state.uid, state.data.games, preparedGame);
  toast("Juego guardado.");
}

function openDemoteModal(preparedGame, existingMain) {
  modal.open({
    modalTitle: "Ya hay 2 principales",
    modalEyebrow: "Límite sano, por una vez",
    html: `
      <p class="muted" style="line-height:1.5;margin:0">Para hacer principal a <strong>${escapeHtml(preparedGame.title)}</strong>, elige cuál baja a secundario.</p>
      <div class="field"><label>Juego que baja</label><select name="demoteGameId" required>
        ${existingMain.map((game) => `<option value="${game.id}">${escapeHtml(game.title)}</option>`).join("")}
      </select></div>
    `,
    confirmText: "Guardar y bajar otro",
    onSubmit: async (values) => {
      await saveGame(state.uid, state.data.games, preparedGame, { demoteGameId: values.demoteGameId });
      toast("Principal actualizado. El sacrificio fue registrado.");
    }
  });
}

function openSessionForm(game) {
  const consoleItem = consoleById(game.consoleId);
  modal.open({
    modalTitle: `Registrar sesión`,
    modalEyebrow: game.title,
    html: `
      <p class="muted" style="margin:0">${escapeHtml(consoleItem?.name || "Sin consola")} · ${categoryLabel(game.category)}</p>
      <div class="form-grid">
        <div class="field"><label>Duración minutos</label><input name="duration" type="number" min="1" required value="45" /></div>
        <div class="field"><label>Rating 1-5</label><input name="rating" type="number" min="1" max="5" value="4" /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Progreso nuevo %</label><input name="progress" type="number" min="0" max="100" value="${escapeHtml(game.progress || 0)}" /></div>
        <div class="field"><label>Mood</label><input name="mood" placeholder="chill, intenso, sufrí" /></div>
      </div>
      <label class="field" style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:10px">
        <input name="completed" type="checkbox" />
        <span>Marcar como completado</span>
      </label>
      <div class="field"><label>Nota</label><textarea name="note" placeholder="Qué pasó, qué misión hiciste, qué jefe te humilló..."></textarea></div>
    `,
    confirmText: "Guardar sesión",
    onSubmit: async (values) => {
      await registerSession(state.uid, game, {
        ...values,
        completed: values.completed === "on"
      });
      toast("Sesión guardada. Otra decisión humana convertida en estadística.");
    }
  });
}

function openCategoryModal(game) {
  const options = Object.entries(CATEGORY_META).map(([id, meta]) => `
    <option value="${id}" ${game.category === id ? "selected" : ""}>${meta.icon} ${meta.label}</option>
  `).join("");
  modal.open({
    modalTitle: "Cambiar categoría",
    modalEyebrow: game.title,
    html: `<div class="field"><label>Categoría</label><select name="category">${options}</select></div>`,
    onSubmit: async (values) => {
      const updated = { ...game, category: values.category, allowInRotation: values.category === "main" ? true : game.allowInRotation };
      await submitGameWithLimit(updated);
    }
  });
}

function openGameStats(game) {
  const sessions = sessionsForGame(game.id).sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  const avg = averageRatingFromSessions(game.id);
  modal.open({
    modalTitle: game.title,
    modalEyebrow: "Stats del juego",
    html: `
      <div class="kpi-grid">
        <article class="kpi-card"><span>Tiempo</span><strong>${minutesLabel(game.totalMinutes || 0)}</strong></article>
        <article class="kpi-card"><span>Sesiones</span><strong>${sessions.length}</strong></article>
        <article class="kpi-card"><span>Progreso</span><strong>${percent(game.progress)}%</strong></article>
        <article class="kpi-card"><span>Rating</span><strong>${stars(avg)}</strong></article>
      </div>
      <div class="session-list">
        ${sessions.length ? sessions.slice(0, 10).map(sessionRowHtml).join("") : `<div class="empty-state">Sin sesiones todavía.</div>`}
      </div>
    `,
    confirmText: "Cerrar",
    cancelText: "Cerrar",
    onSubmit: async () => {}
  });
}

async function completeGame(game) {
  await updateGame(state.uid, { ...game, category: "completed", allowInRotation: false, completedAt: Date.now(), progress: 100 });
  toast("Juego completado. Mini celebración sobria: 🎉");
}

function openCuriosityMode() {
  const curious = state.data.games.filter((game) => game.category === "curiosity");
  if (!curious.length) {
    openGameForm({}, { category: "curiosity", allowInRotation: false });
    return;
  }

  modal.open({
    modalTitle: "Modo curioso",
    modalEyebrow: "Exploraciones",
    html: `
      <p class="muted" style="margin:0;line-height:1.5">Elige una curiosidad para registrar sesión. Sí cuenta en estadísticas, solo no manda en el plan principal.</p>
      <div class="field"><label>Juego</label><select name="gameId">
        ${curious.map((game) => `<option value="${game.id}">${escapeHtml(game.title)}</option>`).join("")}
      </select></div>
    `,
    confirmText: "Registrar sesión",
    cancelText: "Cancelar",
    onSubmit: async (values) => {
      const game = gameById(values.gameId);
      if (game) setTimeout(() => openSessionForm(game), 80);
    }
  });
}

function openQuickSession() {
  const games = playableGames();
  if (!games.length) return toast("No hay juegos disponibles para registrar sesión.");
  modal.open({
    modalTitle: "Sesión rápida",
    modalEyebrow: "Registro",
    html: `
      <div class="field"><label>Juego</label><select name="gameId">
        ${games.map((game) => `<option value="${game.id}">${escapeHtml(game.title)} · ${categoryLabel(game.category)}</option>`).join("")}
      </select></div>
    `,
    confirmText: "Continuar",
    onSubmit: async (values) => {
      const game = gameById(values.gameId);
      if (game) setTimeout(() => openSessionForm(game), 80);
    }
  });
}

async function swapToday() {
  const current = getTodayPlan(state.data);
  const game = pickGame(state.data, { includeSecondary: true, avoidRecent: true, excludeGameIds: current?.gameId ? [current.gameId] : [] });
  if (!game) return toast("No hay candidatos para sugerir.");
  await saveTodayPlan(state.uid, game, "manual-swap");
  toast("Sugerencia cambiada.");
}

function spinRotator() {
  const options = {
    includeSecondary: $("#rotIncludeSecondary").checked,
    includeCuriosity: $("#rotIncludeCuriosity").checked,
    avoidRecent: $("#rotAvoidRecent").checked,
    shortSession: $("#rotShortSession").checked
  };
  options.ignoreGenreRotation = !$("#rotAlternateGenre").checked;
  const candidates = state.data.games.filter((game) => {
    if (["completed", "paused", "wishlist"].includes(game.category)) return false;
    if (game.rotationEnabled === false) return false;
    if (game.category === "main") return true;
    if (game.category === "secondary") return options.includeSecondary && game.allowInRotation !== false;
    if (game.category === "curiosity") return options.includeCuriosity;
    return false;
  });
  if (!candidates.length) return toast("No hay candidatos para esa combinación.");

  let ticks = 0;
  const interval = setInterval(() => {
    const randomGame = candidates[Math.floor(Math.random() * candidates.length)];
    els.rotatorResult.innerHTML = `<div class="slot-game"><p class="eyebrow">Buscando</p><h2>${escapeHtml(randomGame.title)}</h2></div>`;
    ticks += 1;
    if (ticks >= 12) {
      clearInterval(interval);
      const selected = pickGame(state.data, options) || candidates[0];
      state.lastRotatorGame = selected;
      const consoleItem = consoleById(selected.consoleId);
      els.rotatorResult.innerHTML = `
        <div class="slot-game">
          <p class="eyebrow">Resultado</p>
          <h2>${escapeHtml(selected.title)}</h2>
          <div class="hero-meta" style="justify-content:center;margin-top:10px">
            ${categoryBadge(selected.category)}
            <span class="mini-pill">${escapeHtml(consoleItem?.name || "Sin consola")}</span>
            <span class="mini-pill">${relativeDay(selected.lastPlayed)}</span>
          </div>
          <div class="hero-actions" style="margin-top:16px">
            <button class="btn primary" type="button" data-action="play" data-id="${selected.id}">Registrar sesión</button>
            <button class="btn" type="button" data-action="set-today" data-id="${selected.id}">Poner como hoy</button>
          </div>
        </div>
      `;
    }
  }, 75);
}

async function exportBackup() {
  downloadJson(`game-rotator-backup-${todayISO()}.json`, {
    exportedAt: new Date().toISOString(),
    version: "firebase-command-center-v1",
    ...state.data
  });
}

async function importBackup(file) {
  const json = await readFileAsJson(file);
  const imported = await importBackupToFirestore(state.uid, json);
  const sessionsWithMinutes = imported.sessions.filter((session) => Number(session.duration) > 0).length;
  const legacyNote = imported.source === "legacy-backup"
    ? ` Historial viejo recuperado: ${sessionsWithMinutes}/${imported.sessions.length} sesiones tienen minutos reales.`
    : "";
  toast(`Backup importado: ${imported.games.length} juegos, ${imported.sessions.length} sesiones.${legacyNote}`);
}

function setupEvents() {
  els.btnLogin.addEventListener("click", async () => {
    try { await loginWithGoogle(); }
    catch (error) { toast(`No se pudo iniciar sesión: ${error.message}`); }
  });
  els.btnLogout.addEventListener("click", () => logout());

  setupNavigation((view) => {
    state.view = view;
    setActiveView(view);
    if (view === "stats") renderStats();
  });

  document.querySelector("#btnAddGame")?.addEventListener("click", () => openGameForm());
  document.querySelector("#btnAddGameFromToday")?.addEventListener("click", () => openGameForm());
  document.querySelector("#btnAddConsole")?.addEventListener("click", () => openConsoleForm());
  document.querySelector("#btnQuickSession")?.addEventListener("click", openQuickSession);
  document.querySelector("#btnCuriosityMode")?.addEventListener("click", openCuriosityMode);
  document.querySelector("#btnSwapToday")?.addEventListener("click", swapToday);
  document.querySelector("#btnSpin")?.addEventListener("click", spinRotator);
  document.querySelector("#btnExport")?.addEventListener("click", exportBackup);
  document.querySelector("#btnMigrate")?.addEventListener("click", async () => {
    if (!hasLegacyData()) return toast("No encontré datos antiguos en localStorage.");
    modal.confirm({
      modalTitle: "Migrar datos antiguos",
      message: "Esto copiará tus datos de localStorage a Firebase. No borra los datos locales hasta que tú lo hagas manualmente.",
      confirmText: "Migrar",
      onConfirm: async () => {
        await migrateLegacyToFirestore(state.uid);
        toast("Migración completada.");
      }
    });
  });
  document.querySelector("#btnResetCloud")?.addEventListener("click", () => {
    modal.confirm({
      modalTitle: "Borrar datos de Firebase",
      message: "Esto borra consolas, juegos, sesiones y planes de tu usuario. No toca el localStorage viejo.",
      confirmText: "Borrar todo",
      danger: true,
      onConfirm: async () => {
        await deleteAllUserData(state.uid);
        state.seededDefaults = false;
        toast("Datos borrados.");
      }
    });
  });

  els.backupInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importBackup(file); }
    catch (error) { toast(`No se pudo importar: ${error.message}`); }
    finally { event.target.value = ""; }
  });

  els.gameSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderGames();
  });
  els.gameSort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGames();
  });

  els.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    renderCategoryFilters();
    renderGames();
  });

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const game = id ? gameById(id) : null;
    const consoleItem = id ? consoleById(id) : null;

    try {
      if (action === "add-game") openGameForm();
      if (action === "add-main-for-console") openGameForm({}, { consoleId: id, category: "main", allowInRotation: true });
      if (action === "play" && game) openSessionForm(game);
      if (action === "edit-game" && game) openGameForm(game);
      if (action === "toggle-rotation" && game) {
        const enabled = game.rotationEnabled === false;
        await updateGame(state.uid, { ...game, rotationEnabled: enabled });
        toast(enabled ? "Juego habilitado para la rotación." : "Juego fuera de la rotación.");
      }
      if (action === "change-category" && game) openCategoryModal(game);
      if (action === "game-stats" && game) openGameStats(game);
      if (action === "complete-game" && game) completeGame(game);
      if (action === "promote-secondary" && game) updateGame(state.uid, { ...game, category: "secondary", allowInRotation: true }).then(() => toast("Subido a secundario."));
      if (action === "set-today" && game) saveTodayPlan(state.uid, game, "rotator").then(() => toast("Quedó como plan de hoy."));
      if (action === "edit-console" && consoleItem) openConsoleForm(consoleItem);
      if (action === "delete-console" && consoleItem) {
        modal.confirm({
          modalTitle: "Eliminar consola",
          message: `Eliminar ${escapeHtml(consoleItem.name)} no borra sus juegos, pero quedarán sin consola hasta que los edites. Sí, elegante como trasteo con cajas sin marcar.`,
          confirmText: "Eliminar",
          danger: true,
          onConfirm: async () => {
            await deleteConsole(state.uid, consoleItem.id);
            toast("Consola eliminada.");
          }
        });
      }
    } catch (error) {
      toast(error.message || "Algo falló.");
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.deferredInstallPrompt = event;
    els.btnInstall.hidden = false;
  });
  els.btnInstall.addEventListener("click", async () => {
    const promptEvent = window.deferredInstallPrompt;
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    window.deferredInstallPrompt = null;
    els.btnInstall.hidden = true;
  });
}

function setupAuth() {
  watchAuth((user) => {
    if (state.unsubscribeData) {
      state.unsubscribeData();
      state.unsubscribeData = null;
    }

    state.user = user;
    state.uid = user?.uid || null;
    state.seededDefaults = false;

    if (!user) {
      els.authGate.hidden = false;
      els.appShell.hidden = true;
      state.data = { consoles: [], games: [], sessions: [], dailyPlans: [] };
      return;
    }

    if (!isAllowedUser(user)) {
      els.authGate.hidden = false;
      els.appShell.hidden = true;
      state.user = null;
      state.uid = null;
      state.data = { consoles: [], games: [], sessions: [], dailyPlans: [] };
      toast(`Acceso restringido a ${ALLOWED_EMAIL}.`);
      logout().catch((error) => console.warn("logout", error));
      return;
    }

    els.authGate.hidden = true;
    els.appShell.hidden = false;
    els.userName.textContent = user.displayName || user.email || "Jugador";
    setSync("Conectando...");

    state.unsubscribeData = watchUserData(
      user.uid,
      async (data) => {
        state.data = normalizeData(data);
        setSync("Sincronizado", true);
        renderAll();
        try { await maybeEnsureDefaultsAndPlan(); }
        catch (error) { console.warn(error); }
      },
      (error) => {
        console.error(error);
        setSync("Error de sync");
        toast(`Firestore dijo no: ${error.message}`);
      }
    );
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SW", error));
  });
}

setupEvents();
setupAuth();
registerServiceWorker();
