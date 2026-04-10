import { LS_API_KEY, LS_AI_PROVIDER, LS_AI_MODEL } from "./constants.js";
import { state } from "./state.js";

function wordcloudStatusLangSuffix() {
  return state.currentLang === "en"
    ? ""
    : ` (${state.currentLang.toUpperCase()})`;
}
import { getSecureApiKey, migrateApiKeysToSecureStorage } from "./security.js";
import {
  wordcloudCanvas,
  wordcloudLoading,
  wordcloudStatus,
  wordcloudCategories,
  wordcloudInsights,
  wordcloudTrends,
  wordcloudClearBtn,
  emptyState,
  readerWorkspace,
  wordcloudView,
  wordcloudSplit,
  wordcloudContent,
  readerPane,
  wordcloudMobileBackBtn,
  wordcloudPeriodDaily,
  wordcloudPeriodWeekly,
  wordcloudPeriodMonthly,
  wordcloudChatToggleWrap,
  wordcloudChatBtn,
  wordcloudChatPane,
  wordcloudChatBody,
  closeWordcloudChatBtn,
} from "./dom.js";
import { escapeHtml, getWordcloudCache, setWordcloudCache } from "./utils.js";
import { initWordcloudChat } from "./chat.js";
import { renderReposFromIds } from "./feed.js";
import { getCommentsOpenPref, setCommentsOpenPref } from "./storage.js";
import {
  ErrorHandler,
  DefensiveChecker,
  SafeStorage,
  PerformanceMonitor,
  CacheError,
  SecurityError,
  ValidationError,
} from "./error-handler.js";

// ─── View toggle ──────────────────────────────────────────────────────────────
export function showWordCloudView() {
  emptyState.classList.add("hidden");
  readerWorkspace.classList.add("hidden");
  wordcloudView.classList.remove("hidden");
  readerPane.classList.remove("hidden");

  // Initialize chat state from storage
  initWordcloudChatState();
}

export function hideWordCloudView() {
  wordcloudView.classList.add("hidden");
  emptyState.classList.remove("hidden");
  wordcloudChatPane.classList.add("hidden");
}

// ─── Loader ───────────────────────────────────────────────────────────────────// Loader with comprehensive error handling and defensive programming
export const loadWordCloud = PerformanceMonitor.measureFunction(async function (
  feedKind,
  onCardClick,
) {
  const timer = PerformanceMonitor.startTimer("loadWordCloud");
  let controller = new AbortController();

  try {
    // Validate inputs
    DefensiveChecker.isValidPeriod(feedKind);
    DefensiveChecker.isValidLanguage(state.currentLang);

    // Update period label with error handling
    const periodLabel = document.getElementById("wordcloudPeriodLabel");
    if (periodLabel) {
      periodLabel.textContent = feedKind;
    }

    // 1. Check client cache first with error handling
    try {
      const cachedData = getWordcloudCache(feedKind, state.currentLang);
      if (cachedData) {
        if (wordcloudStatus) {
          wordcloudStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn shrink-0"></span><span class="uppercase tracking-wider">From local cache${wordcloudStatusLangSuffix()}</span></span>`;
        }
        renderWordCloud(cachedData.words);
        renderWordCloudInsights(cachedData, feedKind);
        timer.end();
        return;
      }
    } catch (cacheError) {
      ErrorHandler.handle(
        new CacheError("Failed to read from cache", "CACHE_READ_ERROR"),
        { feedKind, lang: state.currentLang },
      );
      // Continue with API request
    }

    // Show loading state only if not cached
    wordcloudCanvas.style.display = "none";
    wordcloudLoading.classList.remove("hidden");
    wordcloudLoading.classList.add("flex");
    if (wordcloudStatus) {
      wordcloudStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span><span class="uppercase tracking-wider">Analyzing</span></span>`;
    }

    // Get configuration with safe defaults
    const provider = SafeStorage.getItem(LS_AI_PROVIDER, "openai");
    const model = SafeStorage.getItem(LS_AI_MODEL, "").trim();

    // Migrate to secure storage if needed
    try {
      migrateApiKeysToSecureStorage();
    } catch (migrationError) {
      ErrorHandler.handle(
        new SecurityError("Failed to migrate API keys", "MIGRATION_ERROR"),
      );
    }

    // Get API key from secure storage with fallback
    let apiKey;
    try {
      apiKey =
        getSecureApiKey(provider) ||
        getSecureApiKey("default") ||
        SafeStorage.getItem(LS_API_KEY, "").trim();

      // Validate API key if provided
      if (apiKey) {
        DefensiveChecker.isValidApiKey(apiKey);
      }
    } catch (keyError) {
      ErrorHandler.handle(
        new SecurityError("Invalid API key format", "INVALID_API_KEY"),
      );
      apiKey = ""; // Use empty key to continue without API
    }

    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

    // Build query parameters with validation
    const params = new URLSearchParams({
      period: feedKind,
      lang: state.currentLang,
      ...(provider && { provider }),
      ...(model && { model }),
    });

    // Make API request with timeout and error handling
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    let res, data;
    try {
      res = await fetch(`/api/wordcloud?${params}`, {
        headers,
        signal: controller.signal,
      });
      data = await res.json();
    } catch (fetchError) {
      if (fetchError.name === "AbortError") {
        throw new Error("Request timeout - please try again");
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
      controller = null;
    }

    // Validate response
    if (!res.ok || data.error) {
      const errorCode = data.errorCode || "server_error";
      const errorMessage = data.error || "Unknown server error";
      throw new Error(`${errorCode}: ${errorMessage}`);
    }

    // Validate response data structure
    DefensiveChecker.hasProperty(data, "words");
    if (!Array.isArray(data.words)) {
      throw new ValidationError(
        "Response words must be an array",
        "words",
        data.words,
      );
    }

    // 2. Cache the response data with error handling
    try {
      const cacheSuccess = setWordcloudCache(feedKind, state.currentLang, data);
      if (!cacheSuccess) {
        console.warn("Failed to cache response data");
      }
    } catch (cacheError) {
      ErrorHandler.handle(
        new CacheError("Failed to save to cache", "CACHE_WRITE_ERROR"),
      );
      // Continue without caching
    }

    // Update UI
    if (wordcloudStatus) {
      const dotClass = data.isCached ? "bg-hn" : "bg-green-500";
      const statusText = data.isCached
        ? `From server cache${wordcloudStatusLangSuffix()}`
        : `Generated${wordcloudStatusLangSuffix()}`;
      wordcloudStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${dotClass} shrink-0"></span><span class="uppercase tracking-wider">${statusText}</span></span>`;
    }
    renderWordCloud(data.words);
    renderWordCloudInsights(data, feedKind);

    timer.end();
  } catch (error) {
    timer.end();
    const errorMessage = ErrorHandler.handle(error, {
      operation: "loadWordCloud",
      feedKind,
      lang: state.currentLang,
    });

    console.error("WordCloud load error:", error);
    renderWordCloudError("server_error", errorMessage);
  }
}, "loadWordCloud");

// ─── Error ────────────────────────────────────────────────────────────────────
const WC_ERROR_MAP = {
  no_api_key: {
    title: "API Key Required",
    hint: "Add your API key in Settings for AI-powered analysis.",
  },
  invalid_api_key: {
    title: "Invalid API Key",
    hint: "The key was rejected by the provider — check Settings.",
  },
  rate_limit: {
    title: "Rate Limit Reached",
    hint: "Too many requests — wait a moment and try again.",
  },
  quota_exceeded: {
    title: "Quota Exceeded",
    hint: "API credits exhausted — check your provider billing.",
  },
  forbidden: {
    title: "Access Denied",
    hint: "The API key lacks permission for this request.",
  },
  github_rate_limit: {
    title: "GitHub Rate Limit",
    hint: "GitHub is temporarily rate-limiting this server.",
  },
  server_error: {
    title: "Server Error",
    hint: "An unexpected error occurred.",
  },
};

function renderWordCloudError(errorCode, rawMessage) {
  const def = WC_ERROR_MAP[errorCode] ?? {
    title: "Failed",
    hint: rawMessage || "Unknown error.",
  };
  if (wordcloudStatus) {
    wordcloudStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">${def.title}</span></span>`;
  }
  wordcloudLoading.classList.add("hidden");
  wordcloudLoading.classList.remove("flex");

  wordcloudCanvas.style.display = "block";
  const ctx = wordcloudCanvas.getContext("2d");
  ctx.clearRect(0, 0, wordcloudCanvas.width, wordcloudCanvas.height);
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "14px Geist Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    def.title,
    wordcloudCanvas.width / 2,
    wordcloudCanvas.height / 2 - 20,
  );
  ctx.font = "12px Geist Sans, sans-serif";
  ctx.fillStyle = "#71717a";
  ctx.fillText(
    def.hint,
    wordcloudCanvas.width / 2,
    wordcloudCanvas.height / 2 + 10,
  );
}

// ─── Canvas render ────────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  language: "#60a5fa",
  framework: "#34d399",
  domain: "#f59e0b",
  concept: "#a78bfa",
};

function renderWordCloud(words) {
  wordcloudLoading.classList.add("hidden");
  wordcloudLoading.classList.remove("flex");
  wordcloudCanvas.style.display = "block";

  const container = wordcloudCanvas.parentElement;
  wordcloudCanvas.width = Math.max(container.clientWidth - 32, 300);
  wordcloudCanvas.height = 400;

  WordCloud(wordcloudCanvas, {
    list: words.map((w) => [w.text, w.size]),
    gridSize: Math.round(wordcloudCanvas.width / 60),
    weightFactor: Math.round(wordcloudCanvas.width / 150),
    fontFamily: '"Geist Sans", sans-serif',
    color: (word) =>
      CATEGORY_COLORS[words.find((w) => w.text === word)?.category] ??
      "#e4e4e7",
    rotateRatio: 0.3,
    rotationSteps: 2,
    backgroundColor: "transparent",
    click: (item) => {
      if (item?.[0]) handleWordCloudClick(item[0]);
    },
  });
}

// ─── Insights ─────────────────────────────────────────────────────────────────
function renderWordCloudInsights(data, feedKind) {
  if (data.categories) {
    wordcloudCategories.innerHTML = Object.entries(data.categories)
      .map(
        ([k, v]) => `
        <div class="flex justify-between items-center">
          <span class="text-xs text-textMuted capitalize">${k}</span>
          <span class="text-xs font-mono text-hn">${v.count || 0}</span>
        </div>`,
      )
      .join("");
  }

  if (data.insights?.length) {
    wordcloudInsights.innerHTML = data.insights
      .map(
        (s) =>
          `<li class="flex items-start gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn mt-1.5 shrink-0"></span><span>${s}</span></li>`,
      )
      .join("");
  }

  if (data.trends) {
    const trendSection = (label, items, colorClass) =>
      items?.length
        ? `
        <div>
          <h4 class="text-xs font-medium text-textMain mb-2">${label}</h4>
          <div class="flex flex-wrap gap-1">
            ${items.map((t) => `<span class="px-2 py-1 ${colorClass} text-xs rounded-full">${t}</span>`).join("")}
          </div>
        </div>`
        : "";

    wordcloudTrends.innerHTML = [
      trendSection(
        "🚀 Emerging",
        data.trends.emerging,
        "bg-green-500/20 text-green-400",
      ),
      trendSection(
        "💪 Established",
        data.trends.established,
        "bg-blue-500/20 text-blue-400",
      ),
      trendSection(
        "📈 Rising",
        data.trends.rising,
        "bg-amber-500/20 text-amber-400",
      ),
    ].join("");
  }

  const contextText = _buildWordcloudContext(data);
  initWordcloudChat(feedKind, contextText);
}

function _buildWordcloudContext(data) {
  const lines = [];
  if (data.words?.length)
    lines.push(
      "Top trending technologies: " +
        data.words
          .slice(0, 20)
          .map((w) => w.text)
          .join(", ") +
        ".",
    );
  if (data.categories)
    lines.push(
      "Categories — " +
        Object.entries(data.categories)
          .map(([k, v]) => `${k}: ${v.count || 0}`)
          .join(", ") +
        ".",
    );
  if (data.insights?.length)
    lines.push("Key insights: " + data.insights.join(" "));
  if (data.trends?.emerging?.length)
    lines.push("Emerging: " + data.trends.emerging.join(", ") + ".");
  if (data.trends?.rising?.length)
    lines.push("Rising: " + data.trends.rising.join(", ") + ".");
  if (data.trends?.established?.length)
    lines.push("Established: " + data.trends.established.join(", ") + ".");
  return lines.join("\n");
}

// ─── Click-to-filter ──────────────────────────────────────────────────────────
export function handleWordCloudClick(word, onCardClick) {
  const pool = state.allRepos.length > 0 ? state.allRepos : state.currentRepos;
  const lw = word.toLowerCase();
  const filtered = pool.filter(
    (r) =>
      r.description?.toLowerCase().includes(lw) ||
      r.language?.toLowerCase().includes(lw) ||
      r.title?.toLowerCase().includes(lw),
  );
  if (!filtered.length) return;

  const savedAll = state.allRepos;
  renderReposFromIds(filtered, 1, onCardClick);
  state.allRepos = savedAll;
  wordcloudClearBtn.disabled = false;
}

// ─── WordCloud Chat Toggle ───────────────────────────────────────────────────
// Toggle open/close the chat sidebar and sync button pressed state.
export function toggleWordcloudChat() {
  const isHidden = wordcloudChatPane.classList.contains("hidden");
  wordcloudChatPane.classList.toggle("hidden", !isHidden);
  wordcloudChatPane.classList.toggle("flex", isHidden);
  wordcloudChatBtn.setAttribute("aria-pressed", isHidden ? "true" : "false");
  wordcloudChatBtn.classList.toggle("feed-kind-active", isHidden);

  // Save preference to storage
  setCommentsOpenPref(isHidden);
}

// Initialize chat state from storage
export function initWordcloudChatState() {
  const shouldBeOpen = getCommentsOpenPref();
  if (shouldBeOpen && wordcloudChatPane.classList.contains("hidden")) {
    toggleWordcloudChat();
  } else if (!shouldBeOpen && !wordcloudChatPane.classList.contains("hidden")) {
    toggleWordcloudChat();
  }
}

// Wire up static DOM buttons once at module load
if (wordcloudChatBtn) {
  wordcloudChatBtn.addEventListener("click", toggleWordcloudChat);
}

if (closeWordcloudChatBtn) {
  closeWordcloudChatBtn.addEventListener("click", () => {
    wordcloudChatPane.classList.add("hidden");
    wordcloudChatPane.classList.remove("flex");
    wordcloudChatBtn.setAttribute("aria-pressed", "false");
    wordcloudChatBtn.classList.remove("feed-kind-active");

    // Save preference to storage (closed)
    setCommentsOpenPref(false);
  });
}

// ─── Period Toggle ───────────────────────────────────────────────────────────
let currentWordcloudPeriod = "daily";

export function updateCurrentWordcloudPeriod(period) {
  currentWordcloudPeriod = period;
}

export function getCurrentWordcloudPeriod() {
  return currentWordcloudPeriod;
}

function updateWordcloudPeriodButtons(activePeriod) {
  if (!activePeriod) return; // Early return for null/undefined
  
  const buttons = {
    daily: wordcloudPeriodDaily,
    weekly: wordcloudPeriodWeekly,
    monthly: wordcloudPeriodMonthly,
  };

  Object.entries(buttons).forEach(([period, button]) => {
    if (button) {
      const isActive = period === activePeriod;
      button.setAttribute("aria-pressed", isActive.toString());
      button.classList.toggle("feed-kind-active", isActive);
    }
  });
}

function handleWordcloudPeriodChange(period) {
  if (period === currentWordcloudPeriod) return;

  currentWordcloudPeriod = period;
  updateWordcloudPeriodButtons(period);

  // Reload wordcloud with new period
  try {
    loadWordCloud(period, null);
  } catch (error) {
    // Reset status on error
    if (wordcloudStatus) {
      wordcloudStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider">Error</span></span>`;
    }
  }
}

// Wire up period toggle buttons
if (wordcloudPeriodDaily) {
  wordcloudPeriodDaily.addEventListener("click", () =>
    handleWordcloudPeriodChange("daily"),
  );
}
if (wordcloudPeriodWeekly) {
  wordcloudPeriodWeekly.addEventListener("click", () =>
    handleWordcloudPeriodChange("weekly"),
  );
}
if (wordcloudPeriodMonthly) {
  wordcloudPeriodMonthly.addEventListener("click", () =>
    handleWordcloudPeriodChange("monthly"),
  );
}

// Mobile: back button hides wordcloud view and restores feed visibility
if (wordcloudMobileBackBtn) {
  wordcloudMobileBackBtn.addEventListener("click", () => {
    hideWordCloudView();
    // Also hide the readerPane on mobile so the feed pane is visible again
    const readerPaneEl = document.getElementById("readerPane");
    if (readerPaneEl) {
      readerPaneEl.classList.add("hidden");
      readerPaneEl.classList.remove("flex");
    }
  });
}
