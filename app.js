/* Game Rotator - MVP (v1.1)
   - 2 juegos activos por consola
   - sugerencia diaria (evita repetir ayer)
   - ✅ Cambiar sugerencia FUNCIONA aunque no marques "Jugué hoy"
   - localStorage only
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

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const data = {
    meta: { createdAt: Date.now(), version: "1.1" },
    consoles: [
      { id: uid("c"), name: "PS5", weight: 1 },
      { id: uid("c"), name: "Switch", weight: 1 }
    ],
    games: [
      { id: uid("g"), consoleId: null, title: "Agregar juegos 👇", status: "active", lastPlayed: null, completedAt: null }
    ],
    history: [], // {date, consoleId, gameId}
    today: null, // {date, consoleId, gameId}
    skips: {}    // { "YYYY-MM-DD": [{consoleId, gameId}, ...] }
  };

  data.games[0].consoleId = data.consoles[0].id;
  return data;
}

// Migración suave (por si ya tenías rotator_v1 guardado sin "skips")
function migrate(data) {
  if (!data || typeof data !== "object") return seed();
  if (!Array.isArray(data.consoles)) data.consoles = [];
  if (!Array.isArray(data.games)) data.games = [];
  if (!Array.isArray(data.history)) data.history = [];
  if (!data.meta) data.meta = { createdAt: Date.now() };
  if (!data.skips || typeof data.skips !== "object") data.skips = {};
  if (!("today" in data)) data.today = null;
  return data;
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
   Rotation logic
--------------------------- */

function buildCandidatePairs(data) {
  // Candidate pair = (console, one active game)
  const pairs = [];
  for (const c of data.consoles) {
    const active = activeGamesForConsole(data, c.id);
    for (const g of active) {
      pairs.push({ consoleId: c.id, gameId: g.id });
    }
  }
  return pairs;
}

function scorePair(data, pair) {
  // Lower score = better candidate (more "due")
  const g = byId(data.games, pair.gameId);
  const c = byId(data.consoles, pair.consoleId);

  let score = 0;

  // Prefer games not played recently
  if (!g?.lastPlayed) score -= 10;
  else {
    const daysAgo = Math.max(0, Math.floor((Date.now() - g.lastPlayed) / 86400000));
    score -= Math.min(10, daysAgo);
  }

  // Prefer consoles with fewer recent plays (simple)
  const recent = data.history.slice(-14);
  const consoleCount = recent.filter((h) => h.consoleId === pair.consoleId).length;
  score += consoleCount * 2;

  // Weight nudge
  const w = Number(c?.weight || 1);
  score += 1 / Math.max(0.25, w);

  return score;
}

function pickToday(data, { forceNew = false } = {}) {
  const t = todayISO();

  // Init skips map
  if (!data.skips) data.skips = {};
  if (!data.skips[t]) data.skips[t] = [];

  // If already chosen today and not forcing new, reuse
  if (!forceNew && data.today && data.today.date === t) {
    return data.today;
  }

  // Build candidates
  let pairs = buildCandidatePairs(data).filter((p) => {
    const g = byId(data.games, p.gameId);
    return g && g.status === "active";
  });

  if (pairs.length === 0) {
    data.today = { date: t, consoleId: null, gameId: null };
    return data.today;
  }

  // Avoid pairs skipped today
  const skipped = data.skips[t];
  pairs = pairs.filter(
    (p) => !skipped.some((s) => s.consoleId === p.consoleId && s.gameId === p.gameId)
  );

  // If everything was skipped, reset skips for today (so user can cycle again)
  if (pairs.length === 0) {
    data.skips[t] = [];
    pairs = buildCandidatePairs(data).filter((p) => {
      const g = byId(data.games, p.gameId);
      return g && g.status === "active";
    });
  }

  // Avoid repeating yesterday's exact pair if possible
  const y = yesterdayISO();
  const yPick = lastAssignmentForDate(data, y);
  if (yPick) {
    const notYesterday = pairs.filter(
      (p) => !(p.consoleId === yPick.consoleId && p.gameId === yPick.gameId)
    );
    if (notYesterday.length) pairs = notYesterday;
  }

  // Score and pick best
  const scored = pairs
    .map((p) => ({ ...p, score: scorePair(data, p) }))
    .sort((a, b) => a.score - b.score);

  const choice = scored[0];
  data.today = { date: t, consoleId: choice.consoleId, gameId: choice.gameId };
  return data.today;
}

/* ---------------------------
   UI render
--------------------------- */

function render() {
  const data = load();
  const t = todayISO();
  todayTag.textContent = `Hoy: ${t}`;

  // Ensure today suggestion exists
  pickToday(data);
  save(data);

  // Today box
  const today = data.today;
  if (!today || !today.consoleId || !today.gameId) {
    todayBox.innerHTML = `
      <div class="kv">
        <span class="pill">No hay plan todavía 😶</span>
      </div>
      <p class="hint">Agrega consolas y pon 1-2 juegos activos por consola para que el rotador funcione.</p>
    `;
  } else {
    const c = byId(data.consoles, today.consoleId);
    const g = byId(data.games, today.gameId);
    const skippedCount = (data.skips?.[t]?.length || 0);

    todayBox.innerHTML = `
      <div class="kv">
        <span class="pill">Consola: <b>${escapeHtml(c?.name || "—")}</b></span>
        <span class="pill">Juego: <b>${escapeHtml(g?.title || "—")}</b></span>
        <span class="pill">Estado: <b>${g?.status === "active" ? "Por pasar" : "—"}</b></span>
      </div>
      <div class="subhint">
        Última vez jugado: ${g?.lastPlayed ? new Date(g.lastPlayed).toLocaleString("es-CO") : "Nunca"}
        ${skippedCount ? ` · Cambios hoy: ${skippedCount}` : ``}
      </div>
    `;
  }

  // Consoles list
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

  // Games list
  gamesList.innerHTML = "";
  for (const g of data.games) {
    const c = byId(data.consoles, g.consoleId);
    const statusLabel = g.status === "active" ? "Por pasar" : "Completado";
    const badge = "badge";

    gamesList.appendChild(
      el(`
        <div class="item">
          <div class="meta">
            <div class="title">${escapeHtml(g.title)}</div>
            <div class="sub">
              ${escapeHtml(c?.name || "Sin consola")} · ${statusLabel}
              ${g.lastPlayed ? `· Última: ${new Date(g.lastPlayed).toLocaleDateString("es-CO")}` : ""}
            </div>
          </div>
          <div class="mini">
            <span class="${badge}">${statusLabel}</span>
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
    }
  });
});

btnAddGame.addEventListener("click", async () => {
  const data = load();
  if (!data.consoles.length) {
    alert("Primero agrega al menos una consola 😌");
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
          alert("Esa consola ya tiene 2 juegos activos. Completa uno o reactiva otro. 😌");
          return;
        }
      }

      d.games.push({
        id: uid("g"),
        consoleId,
        title,
        status,
        lastPlayed: null,
        completedAt: status === "done" ? Date.now() : null
      });

      d.today = null;
      save(d);
      render();
    }
  });
});

btnPlayed.addEventListener("click", () => {
  const data = load();
  pickToday(data);

  const t = todayISO();
  const today = data.today;

  if (!today?.consoleId || !today?.gameId) {
    alert("No hay plan para marcar. Agrega consolas/juegos primero.");
    return;
  }

  // Save history (1 per day)
  data.history = data.history.filter((h) => h.date !== t);
  data.history.push({ date: t, consoleId: today.consoleId, gameId: today.gameId });

  // Update lastPlayed
  const g = byId(data.games, today.gameId);
  if (g) g.lastPlayed = Date.now();

  // (Opcional) Si jugaste, ya no tiene sentido seguir descartando hoy
  // Puedes comentarlo si quieres conservar los skips aunque juegues.
  // data.skips[t] = [];

  save(data);
  render();
});

btnSwap.addEventListener("click", () => {
  const data = load();
  const t = todayISO();

  // Ensure today exists
  pickToday(data);

  if (!data.skips) data.skips = {};
  if (!data.skips[t]) data.skips[t] = [];

  // Record current suggestion as skipped (so next pick is different)
  if (data.today?.consoleId && data.today?.gameId) {
    data.skips[t].push({ consoleId: data.today.consoleId, gameId: data.today.gameId });
  }

  // Force new suggestion
  pickToday(data, { forceNew: true });
  save(data);
  render();
});

btnComplete.addEventListener("click", () => {
  const data = load();
  pickToday(data);
  const today = data.today;

  if (!today?.gameId) {
    alert("No hay juego para completar.");
    return;
  }

  const g = byId(data.games, today.gameId);
  if (!g) return;

  g.status = "done";
  g.completedAt = Date.now();

  // Clear today so it recalculates
  data.today = null;
  save(data);
  render();
});

btnReset.addEventListener("click", () => {
  const data = load();
  const t = todayISO();
  data.today = null;

  // Reset skips of today too (para que "Cambiar sugerencia" vuelva a ciclar desde cero)
  if (data.skips && data.skips[t]) data.skips[t] = [];

  save(data);
  render();
});

document.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const data = load();

  if (action === "delConsole") {
    const ok = confirm("¿Borrar consola? Esto no borra juegos, pero quedarán ‘sin consola’.");
    if (!ok) return;

    data.consoles = data.consoles.filter((c) => c.id !== id);
    for (const g of data.games) {
      if (g.consoleId === id) g.consoleId = null;
    }

    data.today = null;
    save(data);
    render();
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
      }
    });
  }

  if (action === "delGame") {
    const ok = confirm("¿Borrar juego? Se va para el vacío eterno.");
    if (!ok) return;

    data.games = data.games.filter((g) => g.id !== id);
    data.history = data.history.filter((h) => h.gameId !== id);

    // Remove from today
    if (data.today?.gameId === id) data.today = null;

    // Also remove from skips (all days)
    if (data.skips) {
      for (const day of Object.keys(data.skips)) {
        data.skips[day] = (data.skips[day] || []).filter((s) => s.gameId !== id);
      }
    }

    save(data);
    render();
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
            alert("Esa consola ya tiene 2 juegos activos. Completa uno primero.");
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
      }
    });
  }

  if (action === "toggleGame") {
    const g = byId(data.games, id);
    if (!g) return;

    if (g.status === "active") {
      g.status = "done";
      g.completedAt = Date.now();
    } else {
      // Back to active => validate rule 2
      const act = activeGamesForConsole(data, g.consoleId);
      if (act.length >= 2) {
        alert("Esa consola ya tiene 2 juegos activos. No se puede reactivar.");
        return;
      }
      g.status = "active";
      g.completedAt = null;
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ---------------------------
   Init
--------------------------- */
render();
