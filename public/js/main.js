import { LS_API_KEY, LS_AI_PROVIDER, LS_AI_MODEL, SUPPORTED_LANGUAGES } from "./constants.js";
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
  hideWordCloudView,
  toggleWordcloudChat,
} from "./wordcloud.js";
import {
  getSourceOpenPref,
  setSourceOpenPref,
  getCommentsOpenPref,
  setCommentsOpenPref,
} from "./storage.js";

// ─── Settings modal ───────────────────────────────────────────────────────────
dom.openSettingsBtn.addEventListener("click", () => {
  // Load saved values
  dom.apiKeyInput.value = localStorage.getItem(LS_API_KEY) || "";
  dom.providerSelect.value = localStorage.getItem(LS_AI_PROVIDER) || "openai";
  dom.modelInput.value = localStorage.getItem(LS_AI_MODEL) || "";
  updateModelHint();
  dom.settingsModal.showModal();
});

dom.closeSettingsBtn.addEventListener("click", () => dom.settingsModal.close());

// Provider change handler
dom.providerSelect.addEventListener("change", () => {
  updateModelHint();
});

// Model input handler
dom.modelInput.addEventListener("input", () => {
  updateModelHint();
});

dom.saveKeyBtn.addEventListener("click", () => {
  if (dom.apiKeyInput.value.trim()) {
    localStorage.setItem(LS_API_KEY, dom.apiKeyInput.value.trim());
    localStorage.setItem(LS_AI_PROVIDER, dom.providerSelect.value);
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
  dom.providerSelect.value = "openai";
  dom.modelInput.value = "";
  updateModelHint();
});

// Update model hint based on provider
function updateModelHint() {
  const provider = dom.providerSelect.value;
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
SUPPORTED_LANGUAGES.forEach(({ code, name }) => {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = name;
  if (code === state.currentLang) opt.selected = true;
  dom.langSelect.appendChild(opt);
});
dom.langSelect.addEventListener("change", (e) => {
  setLang(e.target.value);
  if (state.currentActiveRepo)
    handleCardClick(
      state.currentActiveRepo,
      document.getElementById(`card-${state.activeCardId}`),
    );
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
  dom.emptyState.classList.remove("hidden");
  dom.wordcloudView.classList.add("hidden");
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
}

dom.feedKindDaily.addEventListener("click", () => setFeedKind("daily"));
dom.feedKindWeekly.addEventListener("click", () => setFeedKind("weekly"));
dom.feedKindMonthly.addEventListener("click", () => setFeedKind("monthly"));
syncFeedKindButtons();

// ─── Hide-read toggle ─────────────────────────────────────────────────────────
dom.hideReadToggle.addEventListener("click", () => {
  state.hideReadActive = !state.hideReadActive;
  document.body.classList.toggle("hide-read-active", state.hideReadActive);
  if (state.hideReadActive) {
    dom.toggleKnob.classList.replace("translate-x-0", "translate-x-[14px]");
    dom.toggleKnob.classList.replace("bg-textMuted", "bg-hn");
    dom.hideReadToggle.classList.add("border-hn/50");
  } else {
    dom.toggleKnob.classList.replace("translate-x-[14px]", "translate-x-0");
    dom.toggleKnob.classList.replace("bg-hn", "bg-textMuted");
    dom.hideReadToggle.classList.remove("border-hn/50");
  }
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

// ─── Mobile back ──────────────────────────────────────────────────────────────
dom.mobileBackBtn.addEventListener("click", () => {
  closeCommentsPanelLocal(false);
  dom.feedPane.classList.remove("hidden");
  dom.readerPane.classList.add("hidden");
  dom.readerPane.classList.remove("flex");
});

// ─── Wordcloud ────────────────────────────────────────────────────────────────
dom.wordcloudBtn.addEventListener("click", () => {
  showWordCloudView();
  loadWordCloud(state.feedKind, handleCardClick);
});
dom.wordcloudClearBtn.addEventListener("click", () => {
  renderReposFromIds(state.allRepos, 1, handleCardClick);
  dom.statusTextEl.textContent = "Live";
  dom.wordcloudClearBtn.disabled = true;
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

  if (window.innerWidth < 768) {
    dom.feedPane.classList.add("hidden");
    dom.readerPane.classList.remove("hidden");
    dom.readerPane.classList.add("flex");
  }

  dom.emptyState.classList.add("hidden");
  dom.wordcloudView.classList.add("hidden");
  dom.readerWorkspace.classList.remove("hidden");
  dom.readerWorkspace.classList.add("flex");
  dom.readerContent.classList.remove("hidden");
  dom.readerContent.classList.add("flex", "flex-col");

  getCommentsOpenPref()
    ? openCommentsPanelLocal(repo, false)
    : closeCommentsPanelLocal(false);
  closeSourcePanel(false, sourcePanelDeps());
  setReaderViewToggleVisible(false);

  dom.readerBody.classList.remove("animate-reader-in", "opacity-50");
  dom.readerTitle.textContent = repo.title;
  dom.readerBody.innerHTML = "";
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
