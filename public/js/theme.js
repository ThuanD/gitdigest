const LS_THEME = "gitdigest_theme";

const listeners = new Set();

function readPreference() {
  try {
    const saved = localStorage.getItem(LS_THEME);
    if (saved === "light" || saved === "dark") return { theme: saved, explicit: true };
  } catch {
    /* noop */
  }
  const systemLight =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  return { theme: systemLight ? "light" : "dark", explicit: false };
}

function apply(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((fn) => {
    try { fn(theme); } catch (e) { console.error(e); }
  });
  try {
    window.dispatchEvent(new CustomEvent("gitdigest:theme-change", { detail: { theme } }));
  } catch { /* noop */ }
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function setTheme(theme, { persist = true } = {}) {
  const next = theme === "light" ? "light" : "dark";
  apply(next);
  if (persist) {
    try { localStorage.setItem(LS_THEME, next); } catch { /* noop */ }
  }
}

export function toggleTheme() {
  setTheme(getTheme() === "light" ? "dark" : "light");
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme(toggleBtn) {
  const { theme, explicit } = readPreference();
  apply(theme);
  syncToggleIcon(toggleBtn, theme);

  // Follow system changes only when user hasn't made an explicit choice.
  if (!explicit && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => {
      let stillImplicit = true;
      try { stillImplicit = !localStorage.getItem(LS_THEME); } catch { /* noop */ }
      if (!stillImplicit) return;
      apply(e.matches ? "light" : "dark");
      syncToggleIcon(toggleBtn, getTheme());
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      toggleTheme();
      syncToggleIcon(toggleBtn, getTheme());
    });
  }
}

function syncToggleIcon(btn, theme) {
  if (!btn) return;
  const dark = btn.querySelector('[data-theme-icon="dark"]');
  const light = btn.querySelector('[data-theme-icon="light"]');
  // Show moon when in light mode (click → go dark), sun when in dark mode (click → go light).
  if (theme === "light") {
    dark?.classList.remove("hidden");
    light?.classList.add("hidden");
  } else {
    dark?.classList.add("hidden");
    light?.classList.remove("hidden");
  }
}
