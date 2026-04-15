import { LS_READ_STATS, LS_READ_REPOS, LS_FAV_REPOS } from "./constants.js";
import { safeJsonParse } from "./utils.js";
import { activityGraph } from "./dom.js";

// ─── Preference keys ──────────────────────────────────────────────────────────
const COMMENTS_OPEN_KEY = "gitdigest_comments_open_v1";
const SOURCE_OPEN_KEY = "gitdigest_source_open_v1";

export const getCommentsOpenPref = () =>
  localStorage.getItem(COMMENTS_OPEN_KEY) === "1";
export const setCommentsOpenPref = (open) =>
  localStorage.setItem(COMMENTS_OPEN_KEY, open ? "1" : "0");
export const getSourceOpenPref = () =>
  localStorage.getItem(SOURCE_OPEN_KEY) === "1";
export const setSourceOpenPref = (open) =>
  localStorage.setItem(SOURCE_OPEN_KEY, open ? "1" : "0");

// ─── Read tracking ────────────────────────────────────────────────────────────
export function getReadStats() {
  const o = safeJsonParse(localStorage.getItem(LS_READ_STATS) || "{}", {});
  return o && typeof o === "object" && !Array.isArray(o) ? o : {};
}

export function getReadRepos() {
  const a = safeJsonParse(localStorage.getItem(LS_READ_REPOS) || "[]", []);
  return Array.isArray(a) ? a : [];
}

export function isRead(id) {
  return getReadRepos().some((x) => x === id);
}

export function markAsRead(id) {
  const read = getReadRepos();
  if (read.some((x) => x === id)) return;
  read.push(id);
  try {
    localStorage.setItem(LS_READ_REPOS, JSON.stringify(read));
    const stats = getReadStats();
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    stats[key] = (stats[key] || 0) + 1;
    localStorage.setItem(LS_READ_STATS, JSON.stringify(stats));
    renderActivityGraph();
  } catch (e) {
    console.warn("Storage error in markAsRead:", e);
  }
}

// ─── Favorites ────────────────────────────────────────────────────────────────
export function getFavoriteRepos() {
  const a = safeJsonParse(localStorage.getItem(LS_FAV_REPOS) || "[]", []);
  return Array.isArray(a) ? a : [];
}

export function isFavorite(id) {
  return getFavoriteRepos().some((x) => x === id);
}

export function toggleFavorite(id) {
  const favs = getFavoriteRepos();
  const idx = favs.indexOf(id);
  if (idx === -1) favs.push(id);
  else favs.splice(idx, 1);
  try {
    localStorage.setItem(LS_FAV_REPOS, JSON.stringify(favs));
  } catch (e) {
    console.warn("Storage error in toggleFavorite:", e);
  }
  return idx === -1;
}

// ─── Activity graph ───────────────────────────────────────────────────────────
const ACTIVITY_CELL_SIZE = 9;
const ACTIVITY_GAP = 3;
const ACTIVITY_COL_WIDTH = ACTIVITY_CELL_SIZE + ACTIVITY_GAP;
const ACTIVITY_MIN_WEEKS = 10;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]; // Sun-indexed
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function computeActivityWeeks() {
  const wrapper = activityGraph.parentElement?.parentElement;
  const available = wrapper?.clientWidth ?? 0;
  if (!available) return ACTIVITY_MIN_WEEKS;
  const usable = available - 28 - 12; // day col (22) + flex gap (6) + container padding (12)
  const fit = Math.floor((usable + ACTIVITY_GAP) / ACTIVITY_COL_WIDTH);
  return Math.max(ACTIVITY_MIN_WEEKS, fit);
}

function intensityClass(count) {
  if (count >= 6) return "bg-hn";
  if (count >= 3) return "bg-hn/70";
  if (count >= 1) return "bg-hn/40";
  return "bg-surfaceHover";
}

function fmtDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDateHuman(d) {
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function renderDayLabels() {
  const daysEl = document.getElementById("activityDays");
  if (!daysEl) return;
  daysEl.innerHTML = DAY_LABELS.map((l) => `<span>${l}</span>`).join("");
}

function renderMonthLabels(firstDate, numWeeks) {
  const monthsEl = document.getElementById("activityMonths");
  if (!monthsEl) return;
  monthsEl.innerHTML = "";
  let lastMonth = -1;
  for (let col = 0; col < numWeeks; col++) {
    const colStartDate = new Date(firstDate);
    colStartDate.setDate(firstDate.getDate() + col * 7);
    const m = colStartDate.getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const span = document.createElement("span");
      span.textContent = MONTH_LABELS[m];
      span.style.left = `${col * ACTIVITY_COL_WIDTH}px`;
      monthsEl.appendChild(span);
    }
  }
}

function setupTooltip() {
  let tip = document.getElementById("activityTooltip");
  if (!tip) return;
  // Move to body so overflow:hidden on wrapper doesn't clip it
  if (tip.parentElement !== document.body) {
    document.body.appendChild(tip);
  }
  if (tip._wired) return;
  tip._wired = true;

  activityGraph.addEventListener("mouseover", (e) => {
    const cell = e.target.closest("[data-activity-cell]");
    if (!cell) return;
    const count = cell.dataset.count;
    const date = cell.dataset.date;
    const label = count === "0" ? "No reads" : count === "1" ? "1 read" : `${count} reads`;
    tip.textContent = `${label} · ${date}`;
    tip.hidden = false;
    // Measure after content set
    const cRect = cell.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const margin = 6;
    const cellCenter = cRect.left + cRect.width / 2;
    let left = cellCenter - tipRect.width / 2;
    // Clamp horizontally to viewport
    const maxLeft = window.innerWidth - tipRect.width - margin;
    if (left < margin) left = margin;
    else if (left > maxLeft) left = maxLeft;
    let top = cRect.top - tipRect.height - margin;
    // Flip below cell if no room above
    if (top < margin) top = cRect.bottom + margin;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  activityGraph.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget || !activityGraph.contains(e.relatedTarget)) {
      tip.hidden = true;
    }
  });
  window.addEventListener("scroll", () => { tip.hidden = true; }, true);
}

export function renderActivityGraph() {
  const totalReadsEl = document.getElementById("totalReadsText");
  activityGraph.innerHTML = "";

  const stats = getReadStats();
  const totalReads = Object.values(stats).reduce((sum, n) => sum + n, 0);
  if (totalReadsEl) totalReadsEl.textContent = `${totalReads} Total`;

  const today = new Date();
  const numWeeks = computeActivityWeeks();
  const totalDays = (numWeeks - 1) * 7 + (today.getDay() + 1);

  // Date of the first cell rendered (top-left of grid = Sunday of leftmost week)
  const firstDate = new Date();
  firstDate.setDate(today.getDate() - (totalDays - 1));

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const key = fmtDateKey(d);
    const count = stats[key] || 0;

    const cell = document.createElement("div");
    cell.className = `w-[9px] h-[9px] ${intensityClass(count)}`;
    cell.dataset.activityCell = "1";
    cell.dataset.date = fmtDateHuman(d);
    cell.dataset.count = String(count);
    activityGraph.appendChild(cell);
  }

  renderDayLabels();
  renderMonthLabels(firstDate, numWeeks);
  setupTooltip();
}

let _activityResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_activityResizeTimer);
  _activityResizeTimer = setTimeout(renderActivityGraph, 150);
});
