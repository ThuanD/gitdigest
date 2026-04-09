import { SPINNER_SVG } from "./constants.js";
import { state } from "./state.js";
import { feedList, loadMoreBtn, statusDot, statusTextEl } from "./dom.js";
import { escapeHtml } from "./utils.js";
import { isRead } from "./storage.js";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function createFeedSkeletonCard() {
  const el = document.createElement("div");
  el.setAttribute("data-feed-skeleton", "1");
  el.className =
    "repo-card bg-surface border border-borderSubtle p-4 rounded-xl shadow-sm flex flex-col justify-between";
  el.innerHTML = `
    <div class="mb-3 space-y-2.5">
      <div class="ui-skeleton h-3.5 rounded-md" style="width:92%"></div>
      <div class="ui-skeleton h-3.5 rounded-md" style="width:76%"></div>
    </div>
    <div class="flex items-center justify-between pt-3 border-t border-borderSubtle/50">
      <div class="flex gap-2">
        <div class="ui-skeleton h-5 w-16 rounded-md"></div>
        <div class="ui-skeleton h-5 w-14 rounded-md"></div>
      </div>
      <div class="ui-skeleton h-3 w-28 rounded-md"></div>
    </div>`;
  return el;
}

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
    card.className = `repo-card bg-surface border border-borderSubtle p-4 rounded-xl hover:bg-surfaceHover hover:border-borderHover cursor-pointer flex flex-col justify-between group animate-fade-in opacity-0 shadow-sm ${readClass} ${activeClass}`;

    const scoreColor =
      repo.stars > 500
        ? "text-hn"
        : repo.stars > 100
          ? "text-amber-500"
          : "text-textMuted";

    card.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <h3 class="font-medium text-[14px] leading-snug text-textMain group-hover:text-white transition-colors pr-2">${escapeHtml(repo.fullName)}</h3>
        <div class="check-icon ${isRead(repo.id) ? "opacity-100" : "opacity-0"} group-hover:opacity-100 transition-opacity duration-200 text-textMuted">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
      </div>
      <div class="text-sm text-textMuted leading-snug mb-3 line-clamp-2">${escapeHtml(repo.description || "")}</div>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3 text-xs">
          <div class="flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-label="star">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span class="${scoreColor}">${repo.stars}</span>
          </div>
          ${
            repo.language
              ? `
          <div class="flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="programming language">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            <span class="font-mono">${escapeHtml(repo.language)}</span>
          </div>`
              : ""
          }
          <div class="flex items-center gap-1.5 text-textMuted/70">
            <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="fork">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
            </svg>
            <span class="font-mono">${repo.forks ?? 0}</span>
          </div>
        </div>
        <span class="text-xs text-textMuted font-mono">github.com</span>
      </div>`;

    card.addEventListener("click", () => onCardClick(repo, card));
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

    feedList
      .querySelectorAll("[data-feed-skeleton]")
      .forEach((el) => el.remove());
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
