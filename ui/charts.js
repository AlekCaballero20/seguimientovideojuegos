const instances = new Map();
const COLORS = ["#3cff9c", "#55b6ff", "#a78bfa", "#ff4fd8", "#ffd166", "#ff5c7a"];

function resetChart(canvasId) {
  const old = instances.get(canvasId);
  if (old) old.destroy();
  instances.delete(canvasId);
}

function clearFallback(canvas) {
  canvas.hidden = false;
  const oldFallback = canvas.parentElement?.querySelector(`[data-chart-fallback="${canvas.id}"]`);
  if (oldFallback) oldFallback.remove();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function renderFallback(canvas, labels, values) {
  resetChart(canvas.id);
  canvas.hidden = true;

  const oldFallback = canvas.parentElement?.querySelector(`[data-chart-fallback="${canvas.id}"]`);
  if (oldFallback) oldFallback.remove();

  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const rows = total > 0
    ? labels.map((label, index) => {
      const value = Number(values[index]) || 0;
      const percent = Math.round((value / total) * 100);
      const color = COLORS[index % COLORS.length];
      return `
        <div class="chart-row">
          <div class="chart-row-top">
            <strong>${escapeHtml(label)}</strong>
            <span>${value}m · ${percent}%</span>
          </div>
          <div class="chart-bar" aria-hidden="true"><span style="width:${percent}%;background:${color}"></span></div>
        </div>
      `;
    }).join("")
    : `<div class="empty-state">Todavía no hay sesiones para graficar.</div>`;

  canvas.insertAdjacentHTML("afterend", `<div class="chart-fallback" data-chart-fallback="${canvas.id}">${rows}</div>`);
}

export function renderDoughnut(canvasId, labels, values) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const numericValues = values.map((value) => Number(value) || 0);
  if (!window.Chart || numericValues.every((value) => value === 0)) {
    renderFallback(canvas, labels, numericValues);
    return;
  }

  clearFallback(canvas);
  resetChart(canvasId);
  const chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#9fb0c9", boxWidth: 10, font: { weight: "bold" } }
        }
      },
      cutout: "62%"
    }
  });
  instances.set(canvasId, chart);
}
