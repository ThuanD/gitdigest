import { SPINNER_SVG } from "./constants.js";
import { state } from "./state.js";
import { feedList, loadMoreBtn, statusDot, statusTextEl } from "./dom.js";
import { escapeHtml } from "./utils.js";
import { isRead, isFavorite, toggleFavorite } from "./storage.js";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function createFeedSkeletonCard() {
  const el = document.createElement("div");
  el.setAttribute("data-feed-skeleton", "1");
  el.className =
    "repo-card bg-surface border border-borderSubtle px-4 py-3 rounded-lg flex flex-col gap-2";
  el.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="ui-skeleton h-3.5 rounded-md" style="width:55%"></div>
      <div class="ui-skeleton h-3 rounded-md" style="width:64px"></div>
    </div>
    <div class="ui-skeleton h-3 rounded-md" style="width:92%"></div>
    <div class="ui-skeleton h-3 rounded-md" style="width:78%"></div>
    <div class="flex gap-2 pt-1">
      <div class="ui-skeleton h-3 w-16 rounded-md"></div>
      <div class="ui-skeleton h-3 w-12 rounded-md"></div>
    </div>`;
  return el;
}

const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00B4AB",
  Lua: "#000080",
  Zig: "#ec915c",
};
const langDot = (lang) =>
  `<span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background:${LANG_COLORS[lang] || "#8b5cf6"}"></span>`;

// ─── Render cards ─────────────────────────────────────────────────────────────
/**
 * @param {object[]} repos
 * @param {number}   page
 * @param {function} onCardClick  — callback(repo, cardElement)
 */
export function renderReposFromIds(repos, page = 1, onCardClick) {
  if (page === 1) {
    state.allRepos = repos;
    feedList.innerHTML = "";
  } else {
    state.allRepos = [...state.allRepos, ...repos];
  }
  state.currentRepos = state.allRepos;

  const frag = document.createDocumentFragment();
  repos.forEach((repo, i) => {
    const card = document.createElement("div");
    card.style.animationDelay = `${i * 20}ms`;
    card.id = `card-${repo.id}`;

    const readClass = isRead(repo.id) ? "is-read" : "";
    const activeClass = state.activeCardId === repo.id ? "is-active" : "";
    const favClass = isFavorite(repo.id) ? "is-fav" : "";
    card.className = `repo-card bg-surface border border-borderSubtle rounded-lg px-4 py-3 hover:bg-surfaceHover hover:border-borderHover cursor-pointer flex flex-col gap-1.5 group animate-fade-in opacity-0 ${readClass} ${activeClass} ${favClass}`;

    const [owner, repoName] = (repo.fullName || "").split("/");
    const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 3) : [];
    const starsDelta = repo.starsDelta ?? repo.stars_today ?? null;
    const formatK = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3 min-w-0">
        <div class="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span class="text-[11px] font-mono text-textMuted/70 truncate">${escapeHtml(owner || "")}/</span>
          <h3 class="font-semibold text-[14px] leading-tight text-textMain group-hover:text-white transition-colors truncate">${escapeHtml(repoName || repo.fullName)}</h3>
        </div>
        <div class="flex items-center gap-2 shrink-0 text-[11px] font-mono text-textMuted">
          <span class="inline-flex items-center gap-1">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            ${formatK(repo.stars ?? 0)}
          </span>
          ${starsDelta ? `<span class="text-hn">+${formatK(starsDelta)}</span>` : ""}
          <button type="button" class="fav-btn p-0.5 -m-0.5 rounded hover:bg-appBg transition-colors" data-fav-btn aria-label="Toggle favorite" aria-pressed="${isFavorite(repo.id)}" title="Favorite">
            <svg class="w-3.5 h-3.5" fill="${isFavorite(repo.id) ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.32.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.32-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>
          </button>
          <span class="check-icon ${isRead(repo.id) ? "opacity-100" : "opacity-0"} group-hover:opacity-100 transition-opacity text-hn" aria-hidden="true">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          </span>
        </div>
      </div>
      ${repo.description ? `<p class="text-[12.5px] text-textMuted leading-snug line-clamp-2">${escapeHtml(repo.description)}</p>` : ""}
      <div class="flex items-center gap-2 flex-wrap text-[10.5px] font-mono text-textMuted/80 min-w-0">
        ${repo.language ? `<span class="inline-flex items-center gap-1 shrink-0">${langDot(repo.language)}<span class="truncate">${escapeHtml(repo.language)}</span></span>` : ""}
        ${repo.forks ? `<span class="inline-flex items-center gap-1 shrink-0 text-textMuted/60"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>${formatK(repo.forks)}</span>` : ""}
        ${topics.map((t) => `<span class="px-1.5 py-0.5 rounded bg-appBg border border-borderSubtle/70 text-textMuted/75 truncate max-w-[120px]">${escapeHtml(t)}</span>`).join("")}
      </div>`;

    card.addEventListener("click", (e) => {
      const favBtn = e.target.closest("[data-fav-btn]");
      if (favBtn) {
        e.stopPropagation();
        const nowFav = toggleFavorite(repo.id);
        card.classList.toggle("is-fav", nowFav);
        favBtn.setAttribute("aria-pressed", String(nowFav));
        const svg = favBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", nowFav ? "currentColor" : "none");
        if (nowFav) {
          favBtn.classList.remove("is-popping");
          void favBtn.offsetWidth;
          favBtn.classList.add("is-popping");
          favBtn.addEventListener("animationend", () => favBtn.classList.remove("is-popping"), { once: true });
        }
        return;
      }
      onCardClick(repo, card);
    });
    frag.appendChild(card);
  });
  feedList.appendChild(frag);
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loadReposClient(page = 1, feedKind, onCardClick) {
  loadMoreBtn.disabled = true;
  loadMoreBtn.innerHTML = `${SPINNER_SVG}<span>Loading…</span>`;
  statusDot.classList.add("animate-pulse");
  statusTextEl.textContent = "Loading…";

  const skeletonCount = page === 1 ? 5 : 3;
  if (page === 1) feedList.innerHTML = "";
  for (let i = 0; i < skeletonCount; i++)
    feedList.appendChild(createFeedSkeletonCard());

  try {
    const res = await fetch(`/api/repos?period=${feedKind}&page=${page}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const skeletons = feedList.querySelectorAll("[data-feed-skeleton]");
    if (skeletons.length) {
      skeletons.forEach((el) => {
        el.style.transition = "opacity 0.15s ease";
        el.style.opacity = "0";
      });
      await new Promise((r) => setTimeout(r, 150));
      skeletons.forEach((el) => el.remove());
    }
    renderReposFromIds(data.repos || [], page, onCardClick);

    if (data.hasMore) {
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.textContent = "Load More";
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn.classList.add("hidden");
    }

    if (page === 1) {
      statusDot.classList.remove("animate-pulse");
      statusTextEl.textContent = "Live";
    }
  } catch (e) {
    console.error("Load repos error:", e);
    statusDot.classList.remove("animate-pulse");
    statusTextEl.textContent = "Error";
    feedList
      .querySelectorAll("[data-feed-skeleton]")
      .forEach((el) => el.remove());

    const isRateLimit = e.message?.includes("403");
    const errorMessage = isRateLimit
      ? "GitHub API rate limit exceeded"
      : "Failed to load repositories";
    const errorHint = isRateLimit
      ? "Please wait a few minutes before trying again"
      : "";

    if (page === 1) {
      feedList.innerHTML = `
        <div class="col-span-full text-center py-8">
          <svg class="w-12 h-12 mb-4 text-borderSubtle mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-sm text-textMuted mb-2">${errorMessage}</p>
          ${errorHint ? `<p class="text-xs text-textMuted mb-3">${errorHint}</p>` : ""}
          <button type="button" onclick="location.reload()"
            class="px-4 py-2 bg-hn text-white rounded-lg hover:bg-hn/90 transition-colors">Retry ↻</button>
        </div>`;
    } else {
      loadMoreBtn.textContent = "Failed to load";
      loadMoreBtn.disabled = true;
      loadMoreBtn.classList.remove("hidden");
    }
  }
}
