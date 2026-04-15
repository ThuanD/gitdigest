import { LS_API_KEY, LS_AI_PROVIDER, LS_AI_MODEL } from "./constants.js";
import { state, setLang, setFeedKindState } from "./state.js";
import * as dom from "./dom.js";
import { renderActivityGraph } from "./storage.js";
import { renderReposFromIds, loadReposClient } from "./feed.js";
import { loadSummaryForRepo } from "./summary.js";
import {
  openSourcePanel,
  closeSourcePanel,
} from "./readme.js";
import { loadChatContent } from "./chat.js";
import {
  loadWordCloud,
  showWordCloudView,
  toggleWordcloudChat,
  getCurrentWordcloudPeriod,
  updateCurrentWordcloudPeriod,
} from "./wordcloud.js";
import {
  getSourceOpenPref,
  setSourceOpenPref,
  getCommentsOpenPref,
  setCommentsOpenPref,
} from "./storage.js";
import { createDropdown } from "./dropdown.js";
import { setStatusHtml } from "./utils.js";
import { initTheme } from "./theme.js";

// Initialize theme (reads data-theme already set by the pre-hydrate script).
initTheme(dom.themeToggleBtn);

// Mobile breakpoint constant
const MOBILE_BREAKPOINT = 768;

// ─── Settings modal ───────────────────────────────────────────────────────────
const providerDropdownApi = createDropdown(dom.providerDropdown, {
  value: localStorage.getItem(LS_AI_PROVIDER) || "openai",
  onChange: () => updateModelHint(),
});

dom.openSettingsBtn.addEventListener("click", () => {
  // Load saved values
  dom.apiKeyInput.value = localStorage.getItem(LS_API_KEY) || "";
  providerDropdownApi.setValue(localStorage.getItem(LS_AI_PROVIDER) || "openai", false);
  dom.modelInput.value = localStorage.getItem(LS_AI_MODEL) || "";
  updateModelHint();
  dom.settingsModal.showModal();
});

dom.closeSettingsBtn.addEventListener("click", () => dom.settingsModal.close());

// Model input handler
dom.modelInput.addEventListener("input", () => {
  updateModelHint();
});

dom.saveKeyBtn.addEventListener("click", () => {
  if (dom.apiKeyInput.value.trim()) {
    localStorage.setItem(LS_API_KEY, dom.apiKeyInput.value.trim());
    localStorage.setItem(LS_AI_PROVIDER, providerDropdownApi.getValue());
    localStorage.setItem(LS_AI_MODEL, dom.modelInput.value.trim());
    dom.settingsModal.close();
    if (state.currentActiveRepo)
      handleCardClick(
        state.currentActiveRepo,
        document.getElementById(`card-${state.activeCardId}`),
      );
  }
});

dom.clearKeyBtn.addEventListener("click", () => {
  localStorage.removeItem(LS_API_KEY);
  localStorage.removeItem(LS_AI_PROVIDER);
  localStorage.removeItem(LS_AI_MODEL);
  dom.apiKeyInput.value = "";
  providerDropdownApi.setValue("openai", false);
  dom.modelInput.value = "";
  updateModelHint();
});

// Update model hint based on provider
function updateModelHint() {
  const provider = providerDropdownApi.getValue();
  const customModel = dom.modelInput.value.trim();
  
  const defaultModels = {
    openai: "gpt-4o-mini",
    groq: "llama-3.3-70b-versatile",
    openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
    gemini: "gemini-2.0-flash-lite"
  };
  
  const defaultModel = defaultModels[provider];
  
  if (customModel) {
    dom.modelHint.textContent = `Using custom model: ${customModel}`;
    dom.modelHint.className = "text-xs text-hn mb-4";
  } else {
    dom.modelHint.textContent = `Default model: ${defaultModel}`;
    dom.modelHint.className = "text-xs text-textMuted mb-4";
  }
}

// ─── Language selector ────────────────────────────────────────────────────────
createDropdown(dom.langDropdown, {
  value: state.currentLang,
  onChange: (code) => {
    setLang(code);
    if (state.currentActiveRepo)
      handleCardClick(
        state.currentActiveRepo,
        document.getElementById(`card-${state.activeCardId}`),
      );
  },
});

// ─── Nav tab sync (right-pane state: "wordcloud" | "reader") ─────────────────
const LS_NAV_MODE = "gitdigest_nav_mode_v1";

function playPaneEnter(el) {
  if (!el) return;
  el.classList.remove("pane-enter");
  void el.offsetWidth;
  el.classList.add("pane-enter");
}

function syncNavTabs(mode) {
  const wordcloudActive = mode === "wordcloud";
  dom.navTrendsBtn.classList.toggle("feed-kind-active", !wordcloudActive);
  dom.navTrendsBtn.setAttribute("aria-pressed", String(!wordcloudActive));
  dom.wordcloudBtn.classList.toggle("feed-kind-active", wordcloudActive);
  dom.wordcloudBtn.setAttribute("aria-pressed", String(wordcloudActive));
  try {
    localStorage.setItem(LS_NAV_MODE, mode);
  } catch {
    /* storage full */
  }
}

dom.navTrendsBtn.addEventListener("click", () => {
  // Close wordcloud view
  dom.wordcloudView.classList.add("hidden");
  dom.wordcloudChatPane.classList.add("hidden");

  if (state.currentActiveRepo && state.activeCardId) {
    // Restore reader for the active repo
    const card = document.getElementById(`card-${state.activeCardId}`);
    if (card) {
      handleCardClick(state.currentActiveRepo, card);
      return;
    }
  }

  // No active repo — show feed-focus state: empty placeholder on right, feed on left
  dom.readerWorkspace.classList.add("hidden");
  dom.readerWorkspace.classList.remove("flex");
  dom.emptyState.classList.remove("hidden");
  dom.emptyState.classList.add("flex");
  playPaneEnter(dom.emptyState);

  if (window.innerWidth < MOBILE_BREAKPOINT) {
    // Mobile: focus on feed list
    dom.feedPane.classList.remove("hidden");
    dom.readerPane.classList.add("max-md:hidden");
  }
  syncNavTabs("reader");
});

// ─── Feed kind ────────────────────────────────────────────────────────────────
function syncFeedKindButtons() {
  [dom.feedKindDaily, dom.feedKindWeekly, dom.feedKindMonthly].forEach(
    (btn) => {
      const kind = btn.id.replace("feedKind", "").toLowerCase();
      btn.classList.toggle("feed-kind-active", state.feedKind === kind);
      btn.setAttribute(
        "aria-pressed",
        state.feedKind === kind ? "true" : "false",
      );
    },
  );
}

function resetReaderForFeedSwitch() {
  state.activeCardId = null;
  state.currentActiveRepo = null;
  dom.feedList.querySelectorAll(".repo-card.is-active").forEach((el) => {
    el.classList.remove("is-active");
    const icon = el.querySelector(".check-icon");
    if (icon) {
      icon.classList.remove("opacity-100");
      icon.classList.add("opacity-0");
    }
  });
  dom.emptyState.classList.add("hidden");
  dom.wordcloudView.classList.remove("hidden");
  dom.readerWorkspace.classList.add("hidden");
  dom.readerWorkspace.classList.remove("flex");
  dom.readerContent.classList.add("hidden");
  dom.readerContent.classList.remove("flex", "flex-col");
  closeCommentsPanelLocal(false);
  closeSourcePanel(false, sourcePanelDeps());
  setReaderViewToggleVisible(false);
  dom.readerCommentsToggleWrap.classList.add("hidden");
  dom.readerTitleSourceLink.removeAttribute("href");
  dom.readerTitleSourceLink.textContent = "";
  dom.readerTitleSourceLink.classList.add("hidden");
  document.getElementById("readerChat")?.remove();
}

function setFeedKind(kind) {
  if (kind === state.feedKind) return;
  setFeedKindState(kind);
  resetReaderForFeedSwitch();
  state.currentPage = 1;
  loadReposClient(1, state.feedKind, handleCardClick);
  syncFeedKindButtons();
  
  // Sync wordcloud period with feed kind
  updateCurrentWordcloudPeriod(kind);
}

dom.feedKindDaily.addEventListener("click", () => setFeedKind("daily"));
dom.feedKindWeekly.addEventListener("click", () => setFeedKind("weekly"));
dom.feedKindMonthly.addEventListener("click", () => setFeedKind("monthly"));
syncFeedKindButtons();

// ─── Filter state helpers ─────────────────────────────────────────────────────
function wordFilterActive() {
  return state.currentRepos !== state.allRepos;
}
function syncClearBtnState() {
  const anyFilter = state.hideReadActive || state.favOnlyActive || wordFilterActive();
  dom.wordcloudClearBtn.disabled = !anyFilter;
}

function playWaterFlow(btn) {
  if (!btn) return;
  btn.classList.remove("is-flowing");
  void btn.offsetWidth;
  btn.classList.add("is-flowing");
  btn.addEventListener(
    "animationend",
    () => btn.classList.remove("is-flowing"),
    { once: true },
  );
}

// ─── Hide-read toggle ─────────────────────────────────────────────────────────
dom.hideReadToggle.addEventListener("click", () => {
  state.hideReadActive = !state.hideReadActive;
  document.body.classList.toggle("hide-read-active", state.hideReadActive);
  dom.hideReadToggle.classList.toggle("filter-btn-active", state.hideReadActive);
  dom.hideReadToggle.setAttribute("aria-pressed", String(state.hideReadActive));
  if (state.hideReadActive) playWaterFlow(dom.hideReadToggle);
  syncClearBtnState();
});

// ─── Favorites-only toggle ────────────────────────────────────────────────────
dom.favOnlyToggle.addEventListener("click", () => {
  state.favOnlyActive = !state.favOnlyActive;
  document.body.classList.toggle("fav-only-active", state.favOnlyActive);
  dom.favOnlyToggle.classList.toggle("filter-btn-fav-active", state.favOnlyActive);
  dom.favOnlyToggle.setAttribute("aria-pressed", String(state.favOnlyActive));
  if (state.favOnlyActive) playWaterFlow(dom.favOnlyToggle);
  syncClearBtnState();
});

// ─── Load more ────────────────────────────────────────────────────────────────
dom.loadMoreBtn.addEventListener("click", () => {
  state.currentPage++;
  loadReposClient(state.currentPage, state.feedKind, handleCardClick);
});

// ─── Reader view helpers ──────────────────────────────────────────────────────
function setReaderViewToggleVisible(show) {
  dom.readerViewToggle.classList.toggle("hidden", !show);
  dom.readerViewToggle.classList.toggle("inline-flex", show);
  dom.readerViewToggle.classList.toggle("items-stretch", show);
}

function sourcePanelDeps() {
  return {
    setSourceOpenPref,
    readerViewSummaryBtn: dom.readerViewSummaryBtn,
    readerViewSourceBtn: dom.readerViewSourceBtn,
  };
}

// ─── Comments panel ───────────────────────────────────────────────────────────
function openCommentsPanelLocal(repo, persist) {
  if (!repo) return;
  dom.commentsPane.classList.remove("hidden");
  dom.commentsPane.classList.add("flex");
  dom.commentsPane.classList.remove("chat-pane-anim");
  void dom.commentsPane.offsetWidth;
  dom.commentsPane.classList.add("chat-pane-anim");
  if (window.innerWidth < 768) dom.commentsBackdrop.classList.remove("hidden");
  loadChatContent(repo, dom.commentsBody);
  if (persist) setCommentsOpenPref(true);
  syncCommentsButtonUi();
}

function closeCommentsPanelLocal(persist) {
  dom.commentsPane.classList.add("hidden");
  dom.commentsPane.classList.remove("flex");
  dom.commentsBackdrop.classList.add("hidden");
  if (persist) setCommentsOpenPref(false);
  syncCommentsButtonUi();
}

function syncCommentsButtonUi() {
  const open = !dom.commentsPane.classList.contains("hidden");
  dom.readerChatBtn.classList.toggle("feed-kind-active", open);
  dom.readerChatBtn.setAttribute("aria-pressed", open ? "true" : "false");
}

dom.closeCommentsBtn.addEventListener("click", () =>
  closeCommentsPanelLocal(true),
);
dom.commentsBackdrop.addEventListener("click", () =>
  closeCommentsPanelLocal(true),
);
dom.readerChatBtn.addEventListener("click", () => {
  if (!state.currentActiveRepo) return;
  dom.commentsPane.classList.contains("hidden")
    ? openCommentsPanelLocal(state.currentActiveRepo, true)
    : closeCommentsPanelLocal(true);
});

// ─── View toggle buttons ──────────────────────────────────────────────────────
dom.readerViewSummaryBtn.addEventListener("click", async () => {
  if (!state.currentActiveRepo) return;
  if (!dom.sourceFramePanel.classList.contains("hidden")) {
    closeSourcePanel(true, sourcePanelDeps());
    await loadSummaryForRepo(state.currentActiveRepo, {
      onSummaryReady: () =>
        loadChatContent(state.currentActiveRepo, dom.commentsBody),
    });
  }
});
dom.readerViewSourceBtn.addEventListener("click", () => {
  if (!state.currentActiveRepo) return;
  if (dom.sourceFramePanel.classList.contains("hidden")) {
    void openSourcePanel(state.currentActiveRepo, true, sourcePanelDeps());
  }
});

// ─── Mobile back (button only visible on mobile) ──────────────────────────────
dom.mobileBackBtn.addEventListener("click", () => {
  closeCommentsPanelLocal(false);
  // Return to feed list (Trends mode)
  dom.feedPane.classList.remove("hidden");
  dom.readerPane.classList.add("max-md:hidden");
  // Clear active card so reader doesn't auto-restore on next interaction
  if (state.activeCardId) {
    const old = document.getElementById(`card-${state.activeCardId}`);
    if (old) old.classList.remove("is-active");
    state.activeCardId = null;
    state.currentActiveRepo = null;
  }
  syncNavTabs("reader");
});

// ─── Wordcloud ────────────────────────────────────────────────────────────────
dom.wordcloudBtn.addEventListener("click", async () => {
  try {
    // Swap mobile panes first so the wordcloud area shows immediately,
    // then load data (showing skeleton/spinner inside it).
    if (window.innerWidth < MOBILE_BREAKPOINT) {
      dom.feedPane.classList.add("hidden");
      dom.readerPane.classList.remove("max-md:hidden");
    }
    showWordCloudView();
    syncNavTabs("wordcloud");
    playPaneEnter(dom.wordcloudView);
    await loadWordCloud(getCurrentWordcloudPeriod(), handleCardClick);
  } catch (error) {
    console.error("Failed to load WordCloud:", error);
    // Show error status to user
    if (dom.statusTextEl) {
      dom.statusTextEl.textContent = "Error";
    }
    // Optionally show error in WordCloud status
    const wordcloudStatus = document.getElementById("wordcloudStatus");
    if (wordcloudStatus) {
      setStatusHtml(wordcloudStatus, `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider">Error</span></span>`);
    }
  }
});
dom.wordcloudClearBtn.addEventListener("click", () => {
  // Clear word filter
  if (wordFilterActive()) {
    renderReposFromIds(state.allRepos, 1, handleCardClick);
    dom.statusTextEl.textContent = "Live";
  }
  // Clear hide-read
  if (state.hideReadActive) {
    state.hideReadActive = false;
    document.body.classList.remove("hide-read-active");
    dom.hideReadToggle.classList.remove("filter-btn-active");
    dom.hideReadToggle.setAttribute("aria-pressed", "false");
  }
  // Clear favorites-only
  if (state.favOnlyActive) {
    state.favOnlyActive = false;
    document.body.classList.remove("fav-only-active");
    dom.favOnlyToggle.classList.remove("filter-btn-fav-active");
    dom.favOnlyToggle.setAttribute("aria-pressed", "false");
  }
  syncClearBtnState();
});

// ─── Keyboard navigation ──────────────────────────────────────────────────────
function keyboardInFormField() {
  const a = document.activeElement;
  if (!a) return false;
  return (
    a.tagName === "INPUT" ||
    a.tagName === "TEXTAREA" ||
    a.tagName === "SELECT" ||
    a.isContentEditable
  );
}

function navigateFeedByArrow(delta) {
  const cards = Array.from(
    dom.feedList.querySelectorAll(".repo-card[id^='card-']"),
  ).filter((el) => el.offsetParent !== null);
  if (!cards.length) return;
  let idx = cards.findIndex((c) => c.id === `card-${state.activeCardId}`);
  if (idx === -1) idx = delta > 0 ? -1 : cards.length;
  const next = Math.max(0, Math.min(cards.length - 1, idx + delta));
  if (next === idx) return;
  const card = cards[next];
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.click();
}

document.addEventListener("keydown", (e) => {
  if (dom.settingsModal.open || keyboardInFormField()) return;
  if (e.key === "Escape") {
    if (!dom.commentsPane.classList.contains("hidden")) {
      e.preventDefault();
      closeCommentsPanelLocal(true);
      return;
    }
    if (!dom.sourceFramePanel.classList.contains("hidden")) {
      e.preventDefault();
      closeSourcePanel(true, sourcePanelDeps());
      return;
    }
    return;
  }
  if (
    (e.key === "ArrowDown" || e.key === "ArrowUp") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    if (
      !dom.readerBody.contains(document.activeElement) &&
      !dom.commentsBody.contains(document.activeElement)
    ) {
      e.preventDefault();
      navigateFeedByArrow(e.key === "ArrowDown" ? 1 : -1);
    }
    return;
  }
  if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    
    // Handle wordcloud chat toggle
    if (!dom.wordcloudView.classList.contains("hidden")) {
      toggleWordcloudChat();
      return;
    }
    
    if (!state.currentActiveRepo) return;
    dom.commentsPane.classList.contains("hidden")
      ? openCommentsPanelLocal(state.currentActiveRepo, true)
      : closeCommentsPanelLocal(true);
    return;
  }
  if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!state.currentActiveRepo?.url) return;
    e.preventDefault();
    dom.sourceFramePanel.classList.contains("hidden")
      ? void openSourcePanel(state.currentActiveRepo, true, sourcePanelDeps())
      : closeSourcePanel(true, sourcePanelDeps());
    return;
  }
  if (e.key.toLowerCase() === "o" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!state.currentActiveRepo?.url) return;
    e.preventDefault();
    try {
      const u = new URL(state.currentActiveRepo.url);
      if (u.protocol === "http:" || u.protocol === "https:")
        window.open(u.href, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
  }
  
  // Wordcloud period toggle
  if (!dom.wordcloudView.classList.contains("hidden")) {
    const key = e.key.toLowerCase();
    if ((key === "d" || key === "w" || key === "m") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const buttonId = `wordcloudPeriod${key === "d" ? "Daily" : key === "w" ? "Weekly" : "Monthly"}`;
      const button = document.getElementById(buttonId);
      if (button) button.click();
      return;
    }
  }
});

// ─── Card click / reader ──────────────────────────────────────────────────────
async function handleCardClick(repo, cardElement) {
  if (state.activeCardId) {
    const old = document.getElementById(`card-${state.activeCardId}`);
    if (old) {
      old.classList.remove("is-active");
      const icon = old.querySelector(".check-icon");
      if (icon) {
        icon.classList.remove("opacity-100");
        icon.classList.add("opacity-0");
      }
    }
  }
  state.activeCardId = repo.id;
  state.currentActiveRepo = repo;
  cardElement.classList.add("is-active");
  syncNavTabs("reader");

  if (window.innerWidth < MOBILE_BREAKPOINT) {
    dom.readerPane.classList.remove("max-md:hidden");
    dom.feedPane.classList.add("hidden");
  }

  dom.emptyState.classList.add("hidden");
  dom.wordcloudView.classList.add("hidden");
  dom.readerWorkspace.classList.remove("hidden");
  dom.readerWorkspace.classList.add("flex");
  dom.readerContent.classList.remove("hidden");
  dom.readerContent.classList.add("flex", "flex-col");
  playPaneEnter(dom.readerWorkspace);

  getCommentsOpenPref()
    ? openCommentsPanelLocal(repo, false)
    : closeCommentsPanelLocal(false);
  closeSourcePanel(false, sourcePanelDeps());
  setReaderViewToggleVisible(false);

  dom.readerBody.classList.remove("animate-reader-in", "opacity-50");
  dom.readerTitle.textContent = repo.title;
  dom.readerBody.innerHTML = "";
  if (dom.readerStatus) {
    setStatusHtml(dom.readerStatus, `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span><span class="uppercase tracking-wider">Loading</span></span>`);
  }
  document.getElementById("readerChat")?.remove();

  let sourceHref = "";
  try {
    const u = new URL(repo.url ?? "");
    if (u.protocol === "http:" || u.protocol === "https:") sourceHref = u.href;
  } catch {
    /* ignore */
  }

  if (sourceHref) {
    dom.readerTitleSourceLink.href = sourceHref;
    dom.readerTitleSourceLink.textContent = sourceHref;
    dom.readerTitleSourceLink.classList.remove("hidden");
    setReaderViewToggleVisible(true);
  } else {
    dom.readerTitleSourceLink.removeAttribute("href");
    dom.readerTitleSourceLink.textContent = "";
    dom.readerTitleSourceLink.classList.add("hidden");
  }

  dom.readerCommentsToggleWrap.classList.remove("hidden");
  dom.readerContent.scrollTop = 0;

  const onSummaryReady = () => {
    if (!dom.commentsPane.classList.contains("hidden"))
      loadChatContent(repo, dom.commentsBody);
  };

  if (getSourceOpenPref() && sourceHref) {
    await openSourcePanel(repo, false, sourcePanelDeps());
  } else {
    await loadSummaryForRepo(repo, { onSummaryReady });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderActivityGraph();
loadReposClient(1, state.feedKind, handleCardClick);

// Restore last right-pane mode (defaults to wordcloud)
const _savedMode = (() => {
  try {
    return localStorage.getItem(LS_NAV_MODE);
  } catch {
    return null;
  }
})();
const _initialMode = _savedMode === "reader" ? "reader" : "wordcloud";

if (_initialMode === "reader") {
  // Mobile: just show feed list (default mobile view). Desktop: show empty state on right.
  dom.wordcloudView.classList.add("hidden");
  dom.readerWorkspace.classList.add("hidden");
  if (window.innerWidth >= MOBILE_BREAKPOINT) {
    dom.emptyState.classList.remove("hidden");
    dom.emptyState.classList.add("flex");
  }
  syncNavTabs("reader");
} else {
  syncNavTabs("wordcloud");
  (async () => {
    try {
      // On mobile, swap panes so wordcloud takes full screen
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        dom.feedPane.classList.add("hidden");
        dom.readerPane.classList.remove("max-md:hidden");
      }
      showWordCloudView();
      await loadWordCloud(getCurrentWordcloudPeriod(), handleCardClick);
    } catch (err) {
      console.error("Initial wordcloud load failed:", err);
    }
  })();
}
