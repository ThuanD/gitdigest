// ─── Constants ────────────────────────────────────────────────────────────────
const LS_READ_STATS = "readStats";
const LS_READ_REPOS = "readRepos";
const LS_FEED_KIND = "gh_digest_feed_kind";
const LS_PREF_LANG = "preferredLang";
const LS_API_KEY = "openai_api_key"; // value kept for backward compat

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "ENG" },
  { code: "vi", name: "VN" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const MD_SANITIZE = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "del",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
    "img",
    "iframe",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "title",
    "class",
    "target",
    "rel",
    "width",
    "height",
    "frameborder",
    "allow",
    "allowfullscreen",
    "loading",
  ],
};

function markdownToSafeHtml(md) {
  const raw = marked.parse(String(md ?? ""));
  if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) {
    return DOMPurify.sanitize(raw, MD_SANITIZE);
  }
  return raw;
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentLang = localStorage.getItem(LS_PREF_LANG) || "en";
let activeCardId = null;
let currentActiveRepo = null;
let currentPage = 1;
let hideReadActive = false;
let currentRepos = []; // Currently displayed (may be filtered)
let allRepos = []; // All loaded repos across pages (for wordcloud)
let feedKind = localStorage.getItem(LS_FEED_KIND) || "daily";

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const settingsModal = document.getElementById("settingsModal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const clearKeyBtn = document.getElementById("clearKeyBtn");
const apiKeyInput = document.getElementById("apiKeyInput");
const langSelect = document.getElementById("langSelect");
const feedList = document.getElementById("feedList");
const statusDot = document.getElementById("statusDot");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const readerPane = document.getElementById("readerPane");
const feedPane = document.getElementById("feedPane");
const emptyState = document.getElementById("emptyState");
const readerContent = document.getElementById("readerContent");
const readerTitle = document.getElementById("readerTitle");
const readerTitleSourceLink = document.getElementById("readerTitleSourceLink");
const readerStatus = document.getElementById("readerStatus");
const readerBody = document.getElementById("readerBody");
const readerViewToggle = document.getElementById("readerViewToggle");
const readerViewSummaryBtn = document.getElementById("readerViewSummaryBtn");
const readerViewSourceBtn = document.getElementById("readerViewSourceBtn");
const sourceFramePanel = document.getElementById("sourceFramePanel");
const readerSourceIframeWrap = document.getElementById(
  "readerSourceIframeWrap",
);
const readerCommentsToggleWrap = document.getElementById(
  "readerCommentsToggleWrap",
);
const readerIssuesBtn = document.getElementById("readerIssuesBtn"); // was readerHnBtn
const readerWorkspace = document.getElementById("readerWorkspace");
const commentsPane = document.getElementById("commentsPane");
const commentsBody = document.getElementById("commentsBody");
const commentsBackdrop = document.getElementById("commentsBackdrop");
const closeCommentsBtn = document.getElementById("closeCommentsBtn");
const commentsExternalLink = document.getElementById("commentsExternalLink");
const mobileBackBtn = document.getElementById("mobileBackBtn");
const statusTextEl = document.getElementById("statusText");
const activityGraph = document.getElementById("activityGraph");
const feedKindDaily = document.getElementById("feedKindDaily");
const feedKindWeekly = document.getElementById("feedKindWeekly");
const feedKindMonthly = document.getElementById("feedKindMonthly");
const hideReadToggle = document.getElementById("hideReadToggle");
const toggleKnob = document.getElementById("toggleKnob");

// ─── WordCloud ───────────────────────────────────────────────────────────────────
const wordcloudBtn = document.getElementById("wordcloudBtn");
const wordcloudClearBtn = document.getElementById("wordcloudClearBtn");
const wordcloudModal = document.getElementById("wordcloudModal");
const closeWordcloudBtn = document.getElementById("closeWordcloudBtn");
const wordcloudPeriod = document.getElementById("wordcloudPeriod");
const wordcloudCanvas = document.getElementById("wordcloudCanvas");
const wordcloudLoading = document.getElementById("wordcloudLoading");
const wordcloudStatus = document.getElementById("wordcloudStatus");
const wordcloudCategories = document.getElementById("wordcloudCategories");
const wordcloudInsights = document.getElementById("wordcloudInsights");
const wordcloudTrends = document.getElementById("wordcloudTrends");

// ─── Settings modal ───────────────────────────────────────────────────────────
openSettingsBtn.addEventListener("click", () => {
  apiKeyInput.value = localStorage.getItem(LS_API_KEY) || "";
  settingsModal.showModal();
});
closeSettingsBtn.addEventListener("click", () => settingsModal.close());

saveKeyBtn.addEventListener("click", () => {
  if (apiKeyInput.value.trim()) {
    localStorage.setItem(LS_API_KEY, apiKeyInput.value.trim());
    settingsModal.close();
    if (currentActiveRepo && activeCardId) {
      handleCardClick(
        currentActiveRepo,
        document.getElementById(`card-${activeCardId}`),
      );
    }
  }
});

clearKeyBtn.addEventListener("click", () => {
  localStorage.removeItem(LS_API_KEY);
  apiKeyInput.value = "";
});

// ─── Language selector ────────────────────────────────────────────────────────
SUPPORTED_LANGUAGES.forEach((lang) => {
  const option = document.createElement("option");
  option.value = lang.code;
  option.textContent = lang.name;
  if (lang.code === currentLang) option.selected = true;
  langSelect.appendChild(option);
});

langSelect.addEventListener("change", (e) => {
  currentLang = e.target.value;
  localStorage.setItem(LS_PREF_LANG, currentLang);
  if (currentActiveRepo && activeCardId) {
    handleCardClick(
      currentActiveRepo,
      document.getElementById(`card-${activeCardId}`),
    );
  }
});

// ─── Feed kind (Daily / Weekly / Monthly) ────────────────────────────────────
function syncFeedKindButtons() {
  [feedKindDaily, feedKindWeekly, feedKindMonthly].forEach((btn) => {
    const kind = btn.id.replace("feedKind", "").toLowerCase();
    btn.classList.toggle("feed-kind-active", feedKind === kind);
    btn.setAttribute("aria-pressed", feedKind === kind ? "true" : "false");
  });
}

function resetReaderForFeedSwitch() {
  activeCardId = null;
  currentActiveRepo = null;
  feedList
    .querySelectorAll(".repo-card.is-active")
    .forEach((el) => el.classList.remove("is-active"));
  emptyState.classList.remove("hidden");
  readerWorkspace.classList.add("hidden");
  readerWorkspace.classList.remove("flex");
  readerContent.classList.add("hidden");
  readerContent.classList.remove("flex", "flex-col");
  closeCommentsPanel(false);
  closeSourcePanel(false);
  setReaderViewToggleVisible(false);
  readerCommentsToggleWrap.classList.add("hidden");
  readerTitleSourceLink.removeAttribute("href");
  readerTitleSourceLink.textContent = "";
  readerTitleSourceLink.classList.add("hidden");
}

function setFeedKind(kind) {
  if (kind === feedKind) return;
  feedKind = kind;
  localStorage.setItem(LS_FEED_KIND, feedKind);
  resetReaderForFeedSwitch();
  currentPage = 1;
  loadReposClient(1);
  syncFeedKindButtons();
}

feedKindDaily.addEventListener("click", () => setFeedKind("daily"));
feedKindWeekly.addEventListener("click", () => setFeedKind("weekly"));
feedKindMonthly.addEventListener("click", () => setFeedKind("monthly"));
syncFeedKindButtons();

// ─── Hide-read toggle ─────────────────────────────────────────────────────────
hideReadToggle.addEventListener("click", () => {
  hideReadActive = !hideReadActive;
  document.body.classList.toggle("hide-read-active", hideReadActive);
  if (hideReadActive) {
    toggleKnob.classList.replace("translate-x-0", "translate-x-[14px]");
    toggleKnob.classList.replace("bg-textMuted", "bg-hn");
    hideReadToggle.classList.add("border-hn/50");
  } else {
    toggleKnob.classList.replace("translate-x-[14px]", "translate-x-0");
    toggleKnob.classList.replace("bg-hn", "bg-textMuted");
    hideReadToggle.classList.remove("border-hn/50");
  }
});

// ─── Spinner SVG ──────────────────────────────────────────────────────────────
const SPINNER_SVG = `<svg class="animate-spin h-3.5 w-3.5 text-hn shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

// ─── Skeleton cards ───────────────────────────────────────────────────────────
function createFeedSkeletonCard() {
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

function readerSummarySkeletonHTML() {
  return `<div class="w-full space-y-3 animate-fade-in opacity-0">
    <div class="ui-skeleton h-4 rounded-md" style="width:88%"></div>
    <div class="ui-skeleton h-4 rounded-md w-full"></div>
    <div class="ui-skeleton h-4 rounded-md" style="width:94%"></div>
    <div class="ui-skeleton h-4 rounded-md" style="width:72%"></div>
    <div class="ui-skeleton h-4 rounded-md w-full"></div>
    <div class="ui-skeleton h-4 rounded-md" style="width:56%"></div>
  </div>`;
}

// ─── Activity graph ───────────────────────────────────────────────────────────
function getReadStats() {
  const o = safeJsonParse(localStorage.getItem(LS_READ_STATS) || "{}", {});
  return o && typeof o === "object" && !Array.isArray(o) ? o : {};
}

function renderActivityGraph() {
  const totalReadsEl = document.getElementById("totalReadsText");
  activityGraph.innerHTML = "";

  const stats = getReadStats();
  const totalReads = Object.values(stats).reduce(
    (sum, count) => sum + count,
    0,
  );
  totalReadsEl.textContent = `${totalReads} Total`;

  const today = new Date();
  const numWeeks = 20;
  const totalDays = numWeeks * 7 + (today.getDay() + 1);

  const daysArr = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    daysArr.push(`${y}-${m}-${dd}`);
  }

  daysArr.forEach((dateStr) => {
    const count = stats[dateStr] || 0;
    let colorClass = "bg-surfaceHover";
    if (count > 0 && count <= 2) colorClass = "bg-hn/30";
    else if (count > 2 && count <= 5) colorClass = "bg-hn/60";
    else if (count > 5) colorClass = "bg-hn";

    const cell = document.createElement("div");
    cell.className = `w-[9px] h-[9px] rounded-[2px] transition-colors duration-300 ${colorClass}`;
    cell.title = `${count} posts read on ${dateStr}`;
    activityGraph.appendChild(cell);
  });
}

// ─── Read state ───────────────────────────────────────────────────────────────
function getReadRepos() {
  const a = safeJsonParse(localStorage.getItem(LS_READ_REPOS) || "[]", []);
  return Array.isArray(a) ? a : [];
}

function markAsRead(id) {
  const read = getReadRepos();
  if (!read.some((x) => x === id)) {
    read.push(id);
    try {
      localStorage.setItem(LS_READ_REPOS, JSON.stringify(read));

      const stats = getReadStats();
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      stats[todayStr] = (stats[todayStr] || 0) + 1;
      localStorage.setItem(LS_READ_STATS, JSON.stringify(stats));

      renderActivityGraph();
    } catch (e) {
      console.warn("Storage error in markAsRead:", e);
    }
  }
}

function isRead(id) {
  return getReadRepos().some((x) => x === id);
}

function applyReadState(repo, cardElement) {
  cardElement.classList.add("is-read");
  const icon = cardElement.querySelector(".check-icon");
  if (icon) {
    // Fix: Toggle opacity classes properly instead of looking for non-existent 'hidden' class
    icon.classList.remove("opacity-0");
    icon.classList.add("opacity-100");
  }
  markAsRead(repo.id);
}

// ─── Preferences ──────────────────────────────────────────────────────────────
const COMMENTS_OPEN_PREF_KEY = "github_trending_digest_comments_open_v1";
const SOURCE_OPEN_PREF_KEY = "github_trending_digest_source_open_v1";

const getCommentsOpenPreference = () =>
  localStorage.getItem(COMMENTS_OPEN_PREF_KEY) === "1";
const setCommentsOpenPreference = (open) =>
  localStorage.setItem(COMMENTS_OPEN_PREF_KEY, open ? "1" : "0");
const getSourceOpenPreference = () =>
  localStorage.getItem(SOURCE_OPEN_PREF_KEY) === "1";
const setSourceOpenPreference = (open) =>
  localStorage.setItem(SOURCE_OPEN_PREF_KEY, open ? "1" : "0");

// ─── Reader view toggle ───────────────────────────────────────────────────────
function setReaderViewToggleVisible(show) {
  readerViewToggle.classList.toggle("hidden", !show);
  readerViewToggle.classList.toggle("inline-flex", show);
  readerViewToggle.classList.toggle("items-stretch", show);
}

function syncReaderViewToggleUi() {
  const sourceOpen = !sourceFramePanel.classList.contains("hidden");
  readerViewSummaryBtn.classList.toggle("feed-kind-active", !sourceOpen);
  readerViewSummaryBtn.setAttribute(
    "aria-pressed",
    sourceOpen ? "false" : "true",
  );
  readerViewSourceBtn.classList.toggle("feed-kind-active", sourceOpen);
  readerViewSourceBtn.setAttribute(
    "aria-pressed",
    sourceOpen ? "true" : "false",
  );
}

// ─── README Shadow DOM Utilities ──────────────────────────────────────────────────
function getOrCreateReadmeHost() {
  let host = readerSourceIframeWrap.querySelector('.readme-shadow-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'readme-shadow-host';
    host.style.cssText = "width:100%;height:100%;overflow-y:auto;";
    readerSourceIframeWrap.appendChild(host);
  }
  return host;
}

function getOrCreateShadowRoot(host) {
  let shadowRoot = host.shadowRoot;
  if (!shadowRoot) {
    shadowRoot = host.attachShadow({ mode: 'open' });
  }
  return shadowRoot;
}

function getReadmeStyles() {
  return `
    <style>
      :host {
        display: block;
        color: #e4e4e7;
        font-family: 'Geist Sans', sans-serif;
        line-height: 1.7;
        font-size: 0.9375rem;
        background: #0c0c0e;
        padding: 1.5rem;
        box-sizing: border-box;
      }
      
      /* GitHub-specific overrides for our dark theme */
      h1,h2,h3,h4,h5,h6 { 
        color: #fff !important; 
        border-bottom-color: #27272a !important;
        font-weight: 600;
        margin: 1.5rem 0 0.75rem;
        padding-bottom: 0.4rem;
      }
      h1 { font-size: 1.4rem; }
      h2 { font-size: 1.2rem; }
      h3 { font-size: 1.05rem; }
      h4 { font-size: 0.95rem; }
      
      p { 
        color: #d4d4d8 !important; 
        margin: 0 0 1rem;
      }
      
      a { 
        color: #60a5fa !important; 
        text-decoration: underline;
      }
      a:hover { 
        color: #93c5fd !important; 
      }
      
      /* GitHub badges/shields styling */
      a img[src*="shields.io"], a img[alt*="badge"] {
        display: inline !important;
        vertical-align: middle !important;
        margin: 0 2px !important;
      }
      
      /* Centered div with badges should stay inline */
      div[align="center"], div[align="center"] p {
        text-align: center !important;
      }

      div[align="center"] a {
        display: inline !important;
        margin: 0 2px !important;
      }

      div[align="center"] a img,
      div[align="center"] p a img {
        display: inline !important;
        vertical-align: middle !important;
        max-width: none !important;
        border: none !important;
        border-radius: 0 !important;
        margin: 2px !important;
      }

      /* General badge pattern: <p> containing only <a><img></a> */
      p > a > img[src*="shields.io"],
      p > a > img[src*="badge"],
      p > a > img[src*="camo.githubusercontent"] {
        display: inline !important;
        vertical-align: middle !important;
        margin: 2px !important;
      }
      
      code { 
        font-family: 'Geist Mono', monospace; 
        font-size: 0.8125rem; 
        background-color: #27272a !important; 
        color: #fbbf24 !important; 
        padding: 0.1rem 0.35rem; 
        border-radius: 0.25rem;
      }
      
      pre { 
        background-color: #18181b !important; 
        border: 1px solid #27272a !important; 
        border-radius: 0.5rem; 
        padding: 1rem; 
        overflow-x: auto; 
        margin: 1rem 0;
      }
      
      pre code { 
        background: transparent !important; 
        color: #e4e4e7 !important; 
        padding: 0;
      }
      
      blockquote { 
        border-left: 3px solid #3f3f46 !important; 
        margin: 1rem 0; 
        padding: 0.75rem 1rem; 
        background-color: #18181b !important; 
        border-radius: 0.375rem; 
        color: #a1a1aa !important;
      }
      
      table { 
        border-collapse: collapse; 
        width: 100%; 
        margin: 1rem 0;
        border-color: #27272a !important;
      }
      
      th,td { 
        border: 1px solid #27272a !important; 
        padding: 0.5rem 0.75rem; 
        color: #d4d4d8 !important;
      }
      
      th { 
        background-color: #27272a !important; 
        color: #fff !important; 
        font-weight: 600;
      }
      
      hr { 
        border: none; 
        border-top: 1px solid #27272a !important; 
        margin: 1.5rem 0;
      }
      
      img { 
        max-width: 100%; 
        border-radius: 0.5rem; 
        border: 1px solid #27272a !important; 
        margin: 1rem 0;
      }
      
      ul,ol { 
        color: #d4d4d8 !important; 
        padding-left: 1.5rem; 
        margin: 0 0 1rem; 
      }
      
      li { 
        margin-bottom: 0.25rem;
      }
    </style>
  `;
}

function getLoadingStyles() {
  return `
    <style>
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        gap: 0.75rem;
        padding: 2rem;
        color: #71717a;
        font-family: 'Geist Sans', sans-serif;
        background: #0c0c0e;
        box-sizing: border-box;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .spinner {
        width: 1rem;
        height: 1rem;
        animation: spin 1s linear infinite;
      }
    </style>
  `;
}

function getErrorStyles() {
  return `
    <style>
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        gap: 1rem;
        text-align: center;
        color: #71717a;
        font-family: 'Geist Sans', sans-serif;
        background: #0c0c0e;
        box-sizing: border-box;
        padding: 2rem;
      }
      .icon {
        width: 2rem;
        height: 2rem;
        color: #52525b;
      }
      a {
        color: #ff8533;
        text-decoration: underline;
      }
      .error-text {
        font-size: 0.875rem;
      }
      .error-detail {
        font-size: 0.75rem;
      }
    </style>
  `;
}

function processReadmeLinks(shadowRoot) {
  const links = shadowRoot.querySelectorAll('.readme-content a[href]');
  links.forEach(link => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

function getReadmeHtml(data, repo) {
  if (data.readmeHtml) {
    return data.readmeHtml;
  }
  
  // Fallback to our own markdown parsing
  const fullName = data.rawApiResponse?.full_name || repo.id;
  const branch = data.rawApiResponse?.default_branch || "main";
  const md = resolveReadmeImages(
    data.readmeContent || "*No README available.*",
    fullName,
    branch,
  );
  return typeof marked !== "undefined" ? marked.parse(md) : markdownToSafeHtml(md);
}

// ─── README Rendering Functions ───────────────────────────────────────────────────────
function closeSourcePanel(persistPreference) {
  sourceFramePanel.classList.add("hidden");
  sourceFramePanel.setAttribute("hidden", "");
  readerBody.classList.remove("hidden");
  readerSourceIframeWrap.classList.remove("hidden");
  if (persistPreference) setSourceOpenPreference(false);
  syncReaderViewToggleUi();
}

// Cache for README content to avoid repeated API calls
const readmeCache = new Map();
const README_CACHE_TTL = 30 * 60 * 1000;

function resolveReadmeImages(markdown, fullName, defaultBranch = "main") {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;
  return markdown
    .replace(
      /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
      (_, alt, src) => `![${alt}](${base}/${src.replace(/^\.\//, "")})`,
    )
    .replace(
      /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    )
    .replace(
      /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    );
}

async function openSourcePanelForRepo(repo, persistPreference) {
  if (!repo?.id) return;

  sourceFramePanel.classList.remove("hidden");
  readerBody.classList.add("hidden");
  readerSourceIframeWrap.classList.remove("hidden");
  sourceFramePanel.classList.remove("hidden");
  sourceFramePanel.removeAttribute("hidden");

  if (persistPreference) setSourceOpenPreference(true);
  syncReaderViewToggleUi();

  const cacheKey = repo.id;
  const cached = readmeCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.time < README_CACHE_TTL) {
    renderReadmeContent(cached.data, repo);
    syncReaderViewToggleUi();
    return;
  }

  // Show loading state
  const host = getOrCreateReadmeHost();
  const shadowRoot = getOrCreateShadowRoot(host);
  const loadingHtml = getLoadingStyles() + `
    <svg class="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle style="opacity:0.2" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path style="opacity:0.8" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
    <span style="font-size:0.8125rem;">Loading README...</span>
  `;
  shadowRoot.innerHTML = loadingHtml;

  try {
    const res = await fetch(`/api/repo?repoId=${encodeURIComponent(repo.id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    readmeCache.set(cacheKey, { data, time: now });
    renderReadmeContent(data, repo);
  } catch (err) {
    console.error("README load failed:", err);
    renderReadmeError(err, repo);
  }
}

function renderReadmeContent(data, repo) {
  const host = getOrCreateReadmeHost();
  const shadowRoot = getOrCreateShadowRoot(host);
  
  const html = getReadmeHtml(data, repo);
  const styles = getReadmeStyles();
  
  shadowRoot.innerHTML = styles + `<div class="readme-content">${DOMPurify.sanitize(html, MD_SANITIZE)}</div>`;
  
  processReadmeLinks(shadowRoot);
}

function renderReadmeError(err, repo) {
  const host = getOrCreateReadmeHost();
  const shadowRoot = getOrCreateShadowRoot(host);
  
  const styles = getErrorStyles();
  const content = `
    <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
    <p class="error-text">Failed to load README</p>
    <p class="error-detail">${err.message}</p>
    <a href="${repo.url}" target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>
  `;
  
  shadowRoot.innerHTML = styles + content;
}

function toggleSourcePanelFromUi() {
  if (!currentActiveRepo?.id) return;
  if (!sourceFramePanel.classList.contains("hidden")) closeSourcePanel(true);
  else void openSourcePanelForRepo(currentActiveRepo, true);
}

// ─── Comments / Issues panel ──────────────────────────────────────────────────
function syncCommentsButtonUi() {
  const open = !commentsPane.classList.contains("hidden");
  readerIssuesBtn.classList.toggle("feed-kind-active", open);
  readerIssuesBtn.setAttribute("aria-pressed", open ? "true" : "false");
}

function openCommentsPanelForRepo(repo, persistPreference) {
  if (!repo) return;
  commentsPane.classList.remove("hidden");
  commentsPane.classList.add("flex");
  if (window.innerWidth < 768) commentsBackdrop.classList.remove("hidden");
  commentsExternalLink.href = `${repo.url}/issues`;
  loadGitHubIssues(repo.id, commentsBody);
  if (persistPreference) setCommentsOpenPreference(true);
  syncCommentsButtonUi();
}

function closeCommentsPanel(persistPreference) {
  commentsPane.classList.add("hidden");
  commentsPane.classList.remove("flex");
  commentsBackdrop.classList.add("hidden");
  if (persistPreference) setCommentsOpenPreference(false);
  syncCommentsButtonUi();
}

closeCommentsBtn.addEventListener("click", () => closeCommentsPanel(true));
commentsBackdrop.addEventListener("click", () => closeCommentsPanel(true));

// ─── GitHub Issues loader ─────────────────────────────────────────────────────
async function loadGitHubIssues(repoId, container) {
  container.innerHTML = `
    <div class="flex items-center justify-center py-8">
      <div class="animate-spin h-4 w-4 border-2 border-hn border-t-transparent rounded-full"></div>
      <span class="ml-2 text-sm text-textMuted">Loading issues...</span>
    </div>`;

  try {
    const [owner, repo] = repoId.split("/");
    if (!owner || !repo) {
      container.innerHTML =
        '<p class="text-sm text-textMuted px-2 py-10 text-center">Invalid repository format.</p>';
      return;
    }

    const issuesRes = await fetch(`/api/issues?repoId=${repoId}`);
    if (!issuesRes.ok)
      throw new Error(`Failed to fetch issues: ${issuesRes.status}`);

    const data = await issuesRes.json();
    if (data.error) {
      container.innerHTML = `<p class="text-sm text-textMuted px-2 py-10 text-center">${data.error}</p>`;
      return;
    }

    const issues = data.issues || [];
    if (issues.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8">
          <p class="text-sm text-textMuted mb-2">No issues found</p>
          <a href="${data.repo_url}/issues" target="_blank" class="text-xs text-hn hover:underline">View on GitHub ↗</a>
        </div>`;
      return;
    }

    container.innerHTML = "";
    const listRoot = document.createElement("div");
    listRoot.className = "space-y-4";

    issues.forEach((issue) => {
      const issueEl = document.createElement("div");
      issueEl.className =
        "border border-borderSubtle rounded-lg p-4 hover:bg-surfaceHover transition-colors";

      const labels = (issue.labels || [])
        .map(
          (label) =>
            `<span class="inline-block px-2 py-1 text-xs rounded-full" style="background-color:${label.color}20;color:${label.color}">${label.name}</span>`,
        )
        .join(" ");

      issueEl.innerHTML = `
        <div class="flex items-start justify-between mb-2">
          <h3 class="font-medium text-sm text-textMain">
            <a href="${issue.html_url}" target="_blank" class="hover:text-hn transition-colors">${escapeHtml(issue.title)}</a>
          </h3>
          <span class="text-xs text-textMuted">#${issue.number}</span>
        </div>
        <div class="flex items-center gap-4 text-xs text-textMuted mb-2">
          <span>👤 ${escapeHtml(issue.user.login)}</span>
          <span>💬 ${issue.comments}</span>
          <span>⏰ ${new Date(issue.created_at).toLocaleDateString()}</span>
          ${
            issue.state === "open"
              ? '<span class="text-green-500">🟢 Open</span>'
              : '<span class="text-red-500">🔴 Closed</span>'
          }
        </div>
        ${labels ? `<div class="flex flex-wrap gap-1">${labels}</div>` : ""}`;

      listRoot.appendChild(issueEl);
    });

    container.appendChild(listRoot);

    const footerEl = document.createElement("div");
    footerEl.className = "text-center py-4 border-t border-borderSubtle mt-4";
    footerEl.innerHTML = `<a href="${data.repo_url}/issues" target="_blank" class="text-xs text-hn hover:underline">View all issues on GitHub ↗</a>`;
    container.appendChild(footerEl);
  } catch (error) {
    console.error("Failed to load GitHub issues:", error);
    container.innerHTML = `
      <div class="text-center py-8">
        <p class="text-sm text-textMuted mb-2">Failed to load issues</p>
        <button onclick="loadGitHubIssues('${repoId}', this.closest('.text-center').parentElement)"
          class="text-xs text-hn hover:underline">Retry ↻</button>
      </div>`;
  }
}

// ─── Keyboard navigation ──────────────────────────────────────────────────────
function visibleFeedCards() {
  return Array.from(
    feedList.querySelectorAll(".repo-card[id^='card-']"),
  ).filter((el) => el.offsetParent !== null);
}

function keyboardInFormField() {
  const a = document.activeElement;
  if (!a) return false;
  if (
    a.tagName === "INPUT" ||
    a.tagName === "TEXTAREA" ||
    a.tagName === "SELECT"
  )
    return true;
  return a.isContentEditable;
}

function navigateFeedByArrow(delta) {
  const cards = visibleFeedCards();
  if (!cards.length) return;
  let idx = cards.findIndex((c) => c.id === `card-${activeCardId}`);
  if (idx === -1) idx = delta > 0 ? -1 : cards.length;
  const next = Math.max(0, Math.min(cards.length - 1, idx + delta));
  if (next === idx) return;
  const card = cards[next];
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.click();
}

function toggleCommentsKeyboard() {
  if (!currentActiveRepo) return;
  if (!commentsPane.classList.contains("hidden")) closeCommentsPanel(true);
  else openCommentsPanelForRepo(currentActiveRepo, true);
}

function openCurrentRepoInNewTab() {
  if (!currentActiveRepo?.url) return;
  try {
    const u = new URL(currentActiveRepo.url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      window.open(u.href, "_blank", "noopener,noreferrer");
    }
  } catch {
    /* ignore */
  }
}

document.addEventListener("keydown", (e) => {
  if (settingsModal.open || keyboardInFormField()) return;

  if (e.key === "Escape") {
    if (!commentsPane.classList.contains("hidden")) {
      e.preventDefault();
      closeCommentsPanel(true);
      return;
    }
    if (!sourceFramePanel.classList.contains("hidden")) {
      e.preventDefault();
      closeSourcePanel(true);
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
      !readerBody.contains(document.activeElement) &&
      !commentsBody.contains(document.activeElement)
    ) {
      e.preventDefault();
      navigateFeedByArrow(e.key === "ArrowDown" ? 1 : -1);
    }
    return;
  }
  if (
    (e.key === "c" || e.key === "C") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    e.preventDefault();
    toggleCommentsKeyboard();
    return;
  }
  if (
    (e.key === "s" || e.key === "S") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    if (!currentActiveRepo?.url) return;
    e.preventDefault();
    toggleSourcePanelFromUi();
    return;
  }
  if (
    (e.key === "o" || e.key === "O") &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    if (!currentActiveRepo?.url) return;
    e.preventDefault();
    openCurrentRepoInNewTab();
  }
});

// ─── View toggle buttons ──────────────────────────────────────────────────────
readerViewSummaryBtn.addEventListener("click", async () => {
  if (!currentActiveRepo?.url) return;
  if (!sourceFramePanel.classList.contains("hidden")) {
    closeSourcePanel(true);
    await loadSummaryForRepo(currentActiveRepo);
  }
});

readerViewSourceBtn.addEventListener("click", () => {
  if (!currentActiveRepo?.url) return;
  if (sourceFramePanel.classList.contains("hidden")) {
    void openSourcePanelForRepo(currentActiveRepo, true);
  }
});

readerIssuesBtn.addEventListener("click", () => {
  if (!currentActiveRepo) return;
  toggleCommentsKeyboard();
});

// ─── Mobile back ──────────────────────────────────────────────────────────────
mobileBackBtn.addEventListener("click", () => {
  closeCommentsPanel(false);
  feedPane.classList.remove("hidden");
  readerPane.classList.add("hidden");
  readerPane.classList.remove("flex");
});

// ─── Load more ────────────────────────────────────────────────────────────────
loadMoreBtn.addEventListener("click", () => {
  currentPage++;
  loadReposClient(currentPage);
});

// ─── Repos loader ────
async function loadReposClient(page = 1) {
  loadMoreBtn.disabled = true;
  loadMoreBtn.innerHTML = `${SPINNER_SVG}<span>Loading…</span>`;

  // Add loading status
  statusDot.classList.add("animate-pulse");
  statusTextEl.textContent = "Loading…";

  if (page === 1) {
    feedList.innerHTML = "";
    // Add skeleton cards for initial load
    for (let i = 0; i < 5; i++) feedList.appendChild(createFeedSkeletonCard());
  } else {
    for (let i = 0; i < 3; i++) feedList.appendChild(createFeedSkeletonCard());
  }

  try {
    const res = await fetch(`/api/repos?period=${feedKind}&page=${page}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    feedList
      .querySelectorAll("[data-feed-skeleton]")
      .forEach((el) => el.remove());
    renderReposFromIds(data.repos || [], page);

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

    // Remove loading status
    statusDot.classList.remove("animate-pulse");
    statusTextEl.textContent = "Error";

    feedList
      .querySelectorAll("[data-feed-skeleton]")
      .forEach((el) => el.remove());
    if (page === 1) {
      feedList.innerHTML = `
        <div class="col-span-full text-center py-8 text-textMuted">
          <p class="mb-2">Failed to load repositories</p>
          <button type="button" onclick="location.reload()"
            class="px-4 py-2 bg-hn text-white rounded-lg hover:bg-hn/90 transition-colors">Retry</button>
        </div>`;
    } else {
      loadMoreBtn.textContent = "Failed to load";
      loadMoreBtn.disabled = true;
      loadMoreBtn.classList.remove("hidden");
    }
  }
}

// Extracted from loadReposClient so pagination can call it correctly
function renderReposFromIds(repos, page = 1) {
  if (page === 1) {
    allRepos = repos;
  } else {
    allRepos = [...allRepos, ...repos];
  }
  currentRepos = allRepos;
  feedList.innerHTML = "";

  const frag = document.createDocumentFragment();
  repos.forEach((repo, i) => {
    const card = document.createElement("div");
    card.style.animationDelay = `${i * 20}ms`;
    card.id = `card-${repo.id}`;

    const readClass = isRead(repo.id) ? "is-read" : "";
    const activeClass = activeCardId === repo.id ? "is-active" : "";
    card.className = `repo-card bg-surface border border-borderSubtle p-4 rounded-xl hover:bg-surfaceHover hover:border-borderHover cursor-pointer flex flex-col justify-between group animate-fade-in opacity-0 shadow-sm ${readClass} ${activeClass}`;

    let scoreColor = "text-textMuted";
    if (repo.stars > 500) scoreColor = "text-hn";
    else if (repo.stars > 100) scoreColor = "text-amber-500";

    const titleSafe = escapeHtml(repo.fullName);

    card.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <h3 class="font-medium text-[14px] leading-snug text-textMain group-hover:text-white transition-colors pr-2">${titleSafe}</h3>
        <div class="check-icon ${activeCardId === repo.id ? "opacity-100" : "opacity-0"} group-hover:opacity-100 transition-opacity duration-200 text-textMuted">
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
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
            </svg>
            <span class="font-mono">${repo.forks ?? 0}</span>
          </div>
        </div>
        <span class="text-xs text-textMuted font-mono">github.com</span>
      </div>`;

    card.addEventListener("click", () => handleCardClick(repo, card));
    frag.appendChild(card);
  });
  feedList.appendChild(frag);
}

// ─── Summary helpers ──────────────────────────────────────────────────────────
function summaryStatusLangSuffix() {
  return currentLang === "en" ? "" : ` (${currentLang.toUpperCase()})`;
}

function applyBlankTargets(root) {
  if (!root) return;
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

// ─── Card click / reader ──────────────────────────────────────────────────────
async function handleCardClick(repo, cardElement) {
  if (activeCardId) {
    const oldCard = document.getElementById(`card-${activeCardId}`);
    if (oldCard) oldCard.classList.remove("is-active");
  }
  activeCardId = repo.id;
  currentActiveRepo = repo;
  cardElement.classList.add("is-active");

  if (window.innerWidth < 768) {
    feedPane.classList.add("hidden");
    readerPane.classList.remove("hidden");
    readerPane.classList.add("flex");
  }

  emptyState.classList.add("hidden");
  readerWorkspace.classList.remove("hidden");
  readerWorkspace.classList.add("flex");
  readerContent.classList.remove("hidden");
  readerContent.classList.add("flex", "flex-col");

  if (getCommentsOpenPreference()) {
    openCommentsPanelForRepo(repo, false);
  } else {
    closeCommentsPanel(false);
  }

  closeSourcePanel(false);
  setReaderViewToggleVisible(false);

  readerBody.classList.remove("animate-reader-in", "opacity-50");
  readerTitle.textContent = repo.title;
  readerBody.innerHTML = "";

  let sourceUrlOk = false;
  let sourceHrefForRepo = "";
  if (repo.url) {
    try {
      const u = new URL(repo.url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        sourceHrefForRepo = u.href;
        sourceUrlOk = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (sourceUrlOk) {
    readerTitleSourceLink.href = sourceHrefForRepo;
    readerTitleSourceLink.textContent = sourceHrefForRepo;
    readerTitleSourceLink.classList.remove("hidden");
    setReaderViewToggleVisible(true);
    if (getSourceOpenPreference()) {
      await openSourcePanelForRepo(repo, false);
    } else {
      syncReaderViewToggleUi();
    }
  } else {
    readerTitleSourceLink.removeAttribute("href");
    readerTitleSourceLink.textContent = "";
    readerTitleSourceLink.classList.add("hidden");
  }

  // Show Issues toggle button (only load when panel is actually opened)
  readerCommentsToggleWrap.classList.remove("hidden");
  commentsExternalLink.href = `${repo.url}/issues`;

  readerContent.scrollTop = 0;

  // Load content based on user preference
  if (getSourceOpenPreference()) {
    // User prefers source - go directly to source panel
    await openSourcePanelForRepo(repo, false);
  } else {
    // User prefers summary - load summary
    await loadSummaryForRepo(repo);
  }
}

// ─── Summary loader ───────────────────────────────────────────────────────────
async function loadSummaryForRepo(repo) {
  const localCacheKey = `summary_${repo.id}_${currentLang}`;
  const browserCachedSummary = localStorage.getItem(localCacheKey);

  if (browserCachedSummary) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn shrink-0"></span><span class="uppercase tracking-wider">Loaded from cache${summaryStatusLangSuffix()}</span></span>`;
    readerBody.innerHTML = markdownToSafeHtml(browserCachedSummary);
    applyBlankTargets(readerBody);
    readerBody.classList.remove("hidden");
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");

    // Mark as read when loading from cache too
    const activeCard = document.getElementById(`card-${repo.id}`);
    if (activeCard) applyReadState(repo, activeCard);

    return;
  }

  readerBody.classList.remove("hidden");
  readerBody.classList.add("opacity-50");
  readerBody.innerHTML = readerSummarySkeletonHTML();
  readerStatus.innerHTML = `<span class="flex items-center gap-2">${SPINNER_SVG}<span class="uppercase tracking-wider">Generating summary</span></span>`;

  try {
    const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(
      `/api/summarize?repoId=${encodeURIComponent(repo.id)}&lang=${encodeURIComponent(currentLang)}`,
      { headers },
    );
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      openSettingsBtn.click();
      readerBody.classList.remove("opacity-50");
      readerBody.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mb-4">
            <svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-9h6m-6 0h-6m2 6V7a2 2 0 012-2h6a2 2 0 012 2v5m-2 8h.01M9 16h.01"></path>
            </svg>
          </div>
          <h3 class="text-lg font-medium text-textMain mb-2">API Key Required</h3>
          <p class="text-textMuted text-sm max-w-md">Please add your OpenAI, Groq, or Gemini API key in settings to generate repository summaries.</p>
        </div>`;
      readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">Add API key in settings</span></span>`;
      return;
    }
    if (!res.ok) throw new Error(data.error || "Summary request failed");

    const summary = data.summary;
    if (!summary) throw new Error("Empty summary");

    const statusLabel = data.isCached
      ? `Server cache${summaryStatusLangSuffix()}`
      : `Generated${summaryStatusLangSuffix()}`;
    const dotClass = data.isCached ? "bg-hn" : "bg-green-500";
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${dotClass} shrink-0"></span><span class="uppercase tracking-wider">${statusLabel}</span></span>`;
    readerBody.classList.remove("opacity-50");
    readerBody.innerHTML = markdownToSafeHtml(summary);
    applyBlankTargets(readerBody);
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");

    try {
      localStorage.setItem(localCacheKey, summary);
    } catch {
      /* storage full */
    }

    const activeCard = document.getElementById(`card-${repo.id}`);
    if (activeCard) applyReadState(repo, activeCard);
  } catch (err) {
    console.error(err);
    readerBody.classList.remove("opacity-50");
    readerBody.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
          <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h3 class="text-lg font-medium text-textMain mb-2">Summary Failed</h3>
        <p class="text-textMuted text-sm max-w-md">Failed to generate summary. Please check your API key and try again.</p>
      </div>`;
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">Summary failed — check API key</span></span>`;
  }
}

// ─── WordCloud ───────────────────────────────────────────────────────────────────
wordcloudBtn.addEventListener("click", () => {
  wordcloudModal.showModal();
  loadWordCloud();
});

wordcloudClearBtn.addEventListener("click", () => {
  renderReposFromIds(allRepos, 1);
  statusTextEl.textContent = "Live";
  wordcloudClearBtn.disabled = true;
});

closeWordcloudBtn.addEventListener("click", () => wordcloudModal.close());

async function loadWordCloud() {
  try {
    // Show loading
    wordcloudCanvas.style.display = "none";
    wordcloudLoading.classList.remove("hidden");
    wordcloudLoading.classList.add("flex");
    wordcloudStatus.textContent = "Analyzing…";

    const period = feedKind;
    document.getElementById("wordcloudPeriodLabel").textContent = period;
    const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`/api/wordcloud?period=${period}&lang=`, {
      headers,
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    // Update status
    wordcloudStatus.textContent = data.cached ? "From cache" : "Generated";

    // Render wordcloud
    renderWordCloud(data.words);

    // Render insights
    renderWordCloudInsights(data);
  } catch (error) {
    console.error("WordCloud load error:", error);
    wordcloudStatus.textContent = "Error";
    wordcloudLoading.classList.add("hidden");
    wordcloudLoading.classList.remove("flex");
    // Show error placeholder on canvas
    const ctx = wordcloudCanvas.getContext("2d");
    wordcloudCanvas.style.display = "block";
    ctx.clearRect(0, 0, wordcloudCanvas.width, wordcloudCanvas.height);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "14px Geist Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      error.message?.includes("401")
        ? "API key required"
        : "Failed to load — try again",
      wordcloudCanvas.width / 2,
      wordcloudCanvas.height / 2,
    );
  }
}

function renderWordCloud(words) {
  wordcloudLoading.classList.add("hidden");
  wordcloudLoading.classList.remove("flex");
  wordcloudCanvas.style.display = "block";

  // Resize canvas to match container so wordcloud fills the space
  const container = wordcloudCanvas.parentElement;
  wordcloudCanvas.width = Math.max(container.clientWidth - 32, 300);
  wordcloudCanvas.height = 400;

  // Prepare data for wordcloud2
  const wordList = words.map((word) => [word.text, word.size]);

  // Configure wordcloud
  WordCloud(wordcloudCanvas, {
    list: wordList,
    gridSize: Math.round(wordcloudCanvas.width / 60),
    weightFactor: Math.round(wordcloudCanvas.width / 150),
    fontFamily: '"Geist Sans", sans-serif',
    color: function (word, weight) {
      // Color based on category
      const wordData = words.find((w) => w.text === word);
      if (wordData) {
        switch (wordData.category) {
          case "language":
            return "#60a5fa"; // blue
          case "framework":
            return "#34d399"; // green
          case "domain":
            return "#f59e0b"; // amber
          case "concept":
            return "#a78bfa"; // purple
          default:
            return "#e4e4e7"; // gray
        }
      }
      return "#e4e4e7";
    },
    rotateRatio: 0.3,
    rotationSteps: 2,
    backgroundColor: "transparent",
    click: function (item) {
      if (item && item[0]) {
        handleWordCloudClick(item[0]);
      }
    },
  });
}

function renderWordCloudInsights(data) {
  // Categories
  if (data.categories) {
    const categoriesHtml = Object.entries(data.categories)
      .map(
        ([key, value]) => `
        <div class="flex justify-between items-center">
          <span class="text-xs text-textMuted capitalize">${key}</span>
          <span class="text-xs font-mono text-hn">${value.count || 0}</span>
        </div>
      `,
      )
      .join("");
    wordcloudCategories.innerHTML = categoriesHtml;
  }

  // Insights
  if (data.insights && data.insights.length > 0) {
    const insightsHtml = data.insights
      .map(
        (insight) =>
          `<li class="flex items-start gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn mt-1.5 shrink-0"></span><span>${insight}</span></li>`,
      )
      .join("");
    wordcloudInsights.innerHTML = insightsHtml;
  }

  // Trends
  if (data.trends) {
    const trendsHtml = `
      ${
        data.trends.emerging && data.trends.emerging.length > 0
          ? `
        <div>
          <h4 class="text-xs font-medium text-textMain mb-2">🚀 Emerging</h4>
          <div class="flex flex-wrap gap-1">
            ${data.trends.emerging.map((trend) => `<span class="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">${trend}</span>`).join("")}
          </div>
        </div>
      `
          : ""
      }
      ${
        data.trends.established && data.trends.established.length > 0
          ? `
        <div>
          <h4 class="text-xs font-medium text-textMain mb-2">💪 Established</h4>
          <div class="flex flex-wrap gap-1">
            ${data.trends.established.map((trend) => `<span class="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full">${trend}</span>`).join("")}
          </div>
        </div>
      `
          : ""
      }
      ${
        data.trends.rising && data.trends.rising.length > 0
          ? `
        <div>
          <h4 class="text-xs font-medium text-textMain mb-2">📈 Rising</h4>
          <div class="flex flex-wrap gap-1">
            ${data.trends.rising.map((trend) => `<span class="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full">${trend}</span>`).join("")}
          </div>
        </div>
      `
          : ""
      }
    `;
    wordcloudTrends.innerHTML = trendsHtml;
  }
}

function handleWordCloudClick(word) {
  const pool = allRepos.length > 0 ? allRepos : currentRepos;
  const lw = word.toLowerCase();
  const filteredRepos = pool.filter(
    (s) =>
      s.description?.toLowerCase().includes(lw) ||
      s.language?.toLowerCase().includes(lw) ||
      s.title?.toLowerCase().includes(lw),
  );

  wordcloudModal.close();

  if (filteredRepos.length === 0) return;

  const savedAll = allRepos;
  renderReposFromIds(filteredRepos, 1);
  allRepos = savedAll;

  wordcloudClearBtn.disabled = false;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderActivityGraph();
loadReposClient();
