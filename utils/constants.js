export const LS_KEY = "rotator_v1";

export const CATEGORIES = [
  { id: "all", label: "Todos", icon: "🗂️" },
  { id: "main", label: "Principales", icon: "🎯" },
  { id: "secondary", label: "Secundarios", icon: "🕹️" },
  { id: "curiosity", label: "Curiosidad", icon: "🧪" },
  { id: "paused", label: "Pausados", icon: "⏸️" },
  { id: "completed", label: "Completados", icon: "🏁" },
  { id: "wishlist", label: "Wishlist", icon: "✨" }
];

export const CATEGORY_META = {
  main: { label: "Principal", icon: "🎯", className: "category-main" },
  secondary: { label: "Secundario", icon: "🕹️", className: "category-secondary" },
  curiosity: { label: "Curiosidad", icon: "🧪", className: "category-curiosity" },
  paused: { label: "Pausado", icon: "⏸️", className: "category-paused" },
  completed: { label: "Completado", icon: "🏁", className: "category-completed" },
  wishlist: { label: "Wishlist", icon: "✨", className: "category-wishlist" }
};

export const ROTATION_CATEGORIES = new Set(["main", "secondary"]);
export const MANUAL_PLAYABLE_CATEGORIES = new Set(["main", "secondary", "curiosity", "paused"]);

export const DEFAULT_CONSOLES = [
  { name: "PS5", icon: "🎮", color: "#55b6ff", weight: 1 },
  { name: "Switch", icon: "🔴", color: "#ff5c7a", weight: 1 }
];
