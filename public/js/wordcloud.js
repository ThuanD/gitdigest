import { LS_API_KEY } from "./constants.js";
import { state } from "./state.js";
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
  readerPane,
} from "./dom.js";
import { escapeHtml } from "./utils.js";
import { initWordcloudChat } from "./chat.js";
import { renderReposFromIds } from "./feed.js";

// ─── View toggle ──────────────────────────────────────────────────────────────
export function showWordCloudView() {
  emptyState.classList.add("hidden");
  readerWorkspace.classList.add("hidden");
  wordcloudView.classList.remove("hidden");
  readerPane.classList.remove("hidden");
}

export function hideWordCloudView() {
  wordcloudView.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loadWordCloud(feedKind, onCardClick) {
  wordcloudCanvas.style.display = "none";
  wordcloudLoading.classList.remove("hidden");
  wordcloudLoading.classList.add("flex");
  wordcloudStatus.textContent = "Analyzing…";

  document.getElementById("wordcloudPeriodLabel").textContent = feedKind;

  const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  try {
    const res = await fetch(`/api/wordcloud?period=${feedKind}&lang=`, {
      headers,
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      renderWordCloudError(data.errorCode || "server_error", data.error);
      return;
    }

    wordcloudStatus.textContent = data.isCached ? "From cache" : "Generated";
    renderWordCloud(data.words);
    renderWordCloudInsights(data, feedKind);
  } catch (err) {
    console.error("WordCloud load error:", err);
    renderWordCloudError("server_error", err.message);
  }
}

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
  wordcloudStatus.textContent = def.title;
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
