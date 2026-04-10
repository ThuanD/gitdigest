import { LS_API_KEY, LS_AI_PROVIDER, LS_AI_MODEL, SPINNER_SVG, ERROR_MAP } from "./constants.js";
import { state } from "./state.js";
import { readerStatus, readerBody, openSettingsBtn } from "./dom.js";
import { markdownToSafeHtml, applyBlankTargets } from "./utils.js";
import { markAsRead } from "./storage.js";

export function readerSummarySkeletonHTML() {
  return `<div class="w-full space-y-3 animate-fade-in opacity-0">
    ${Array.from({ length: 6 }, (_, i) => `<div class="ui-skeleton h-4 rounded-md" style="width:${[88, 100, 94, 72, 100, 56][i]}%"></div>`).join("")}
  </div>`;
}

function summaryStatusLangSuffix() {
  return state.currentLang === "en"
    ? ""
    : ` (${state.currentLang.toUpperCase()})`;
}

export function renderSummaryError(errorCode, rawMessage) {
  const def = ERROR_MAP[errorCode] ?? {
    title: "Summary Failed",
    hint: rawMessage || "An unknown error occurred.",
    action: null,
    statusText: "Summary failed",
    statusColor: "bg-red-500",
  };

  readerBody.classList.remove("opacity-50");
  readerBody.innerHTML = `
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <div class="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
        <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <h3 class="text-lg font-medium text-textMain mb-2">${def.title}</h3>
      <p class="text-textMuted text-sm max-w-md">${def.hint}</p>
    </div>`;
  readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${def.statusColor} shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">${def.statusText}</span></span>`;

  if (def.action === "settings") openSettingsBtn.click();
}

export async function loadSummaryForRepo(repo, { onSummaryReady } = {}) {
  const cacheKey = `summary_${repo.id}_${state.currentLang}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn shrink-0"></span><span class="uppercase tracking-wider">Loaded from cache${summaryStatusLangSuffix()}</span></span>`;
    readerBody.innerHTML = markdownToSafeHtml(cached);
    applyBlankTargets(readerBody);
    readerBody.classList.remove("hidden");
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");
    _applyReadAndNotify(repo, onSummaryReady);
    return;
  }

  readerBody.classList.remove("hidden");
  readerBody.classList.add("opacity-50");
  readerBody.innerHTML = readerSummarySkeletonHTML();
  readerStatus.innerHTML = `<span class="flex items-center gap-2">${SPINNER_SVG}<span class="uppercase tracking-wider">Generating summary</span></span>`;

  try {
    const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
    const provider = localStorage.getItem(LS_AI_PROVIDER) || "openai";
    const model = (localStorage.getItem(LS_AI_MODEL) || "").trim();
    
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    
    // Build query parameters
    const params = new URLSearchParams({
      repoId: repo.id,
      lang: state.currentLang,
      ...(provider && { provider }),
      ...(model && { model })
    });

    const res = await fetch(`/api/summarize?${params}`, { headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorCode =
        data.errorCode ||
        (res.status === 401
          ? "no_api_key"
          : res.status === 429
            ? "rate_limit"
            : res.status === 404
              ? "not_found"
              : "server_error");
      renderSummaryError(errorCode, data.error);
      return;
    }

    const summary = data.summary;
    if (!summary) throw new Error("Empty summary");

    const statusLabel = data.isCached
      ? `Cached${summaryStatusLangSuffix()}`
      : `Generated${summaryStatusLangSuffix()}`;
    const dotClass = data.isCached ? "bg-hn" : "bg-green-500";

    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${dotClass} shrink-0"></span><span class="uppercase tracking-wider">${statusLabel}</span></span>`;
    readerBody.classList.remove("opacity-50");
    readerBody.innerHTML = markdownToSafeHtml(summary);
    applyBlankTargets(readerBody);
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");

    try {
      localStorage.setItem(cacheKey, summary);
    } catch {
      /* storage full */
    }
    _applyReadAndNotify(repo, onSummaryReady);
  } catch (err) {
    console.error(err);
    renderSummaryError("server_error", err.message);
  }
}

function _applyReadAndNotify(repo, onSummaryReady) {
  const card = document.getElementById(`card-${repo.id}`);
  if (card) {
    card.classList.add("is-read");
    const icon = card.querySelector(".check-icon");
    if (icon) {
      icon.classList.remove("opacity-0");
      icon.classList.add("opacity-100");
    }
    markAsRead(repo.id);
  }
  onSummaryReady?.();
}
