export function setupNavigation(onNavigate) {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-nav]");
    if (!target) return;
    const view = target.dataset.nav;
    onNavigate(view);
  });
}

export function setActiveView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active-view", view.dataset.view === viewName);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === viewName);
  });
}
