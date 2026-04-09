import { LS_READ_STATS, LS_READ_REPOS } from "./constants.js";
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

// ─── Activity graph ───────────────────────────────────────────────────────────
export function renderActivityGraph() {
  const totalReadsEl = document.getElementById("totalReadsText");
  activityGraph.innerHTML = "";

  const stats = getReadStats();
  const totalReads = Object.values(stats).reduce((sum, n) => sum + n, 0);
  if (totalReadsEl) totalReadsEl.textContent = `${totalReads} Total`;

  const today = new Date();
  const numWeeks = 20;
  const totalDays = numWeeks * 7 + (today.getDay() + 1);

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const count = stats[key] || 0;

    let colorClass = "bg-surfaceHover";
    if (count > 5) colorClass = "bg-hn";
    else if (count > 2) colorClass = "bg-hn/60";
    else if (count > 0) colorClass = "bg-hn/30";

    const cell = document.createElement("div");
    cell.className = `w-[9px] h-[9px] rounded-[2px] transition-colors duration-300 ${colorClass}`;
    cell.title = `${count} posts read on ${key}`;
    activityGraph.appendChild(cell);
  }
}
