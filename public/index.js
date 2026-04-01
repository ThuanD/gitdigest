const FEED_PAGE_SIZE = 15;
const LS_READ_STATS = "readStats";
const LS_READ_STORIES = "readStories";
const LS_DAILY_IDS = "gh_daily_ids";
const LS_DAILY_TIME = "gh_daily_time";
const LS_WEEKLY_IDS = "gh_weekly_ids";
const LS_WEEKLY_TIME = "gh_weekly_time";
const LS_MONTHLY_IDS = "gh_monthly_ids";
const LS_MONTHLY_TIME = "gh_monthly_time";
const LS_FEED_KIND = "gh_digest_feed_kind";
const LS_PREF_LANG = "preferredLang";
const LS_OPENAI_KEY = "openai_api_key";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "ENG" },
  { code: "vi", name: "VN" },
];

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

const COMMENT_SANITIZE = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "i",
    "em",
    "b",
    "strong",
    "code",
    "pre",
    "a",
    "span",
    "div",
  ],
  ALLOWED_ATTR: ["href", "rel", "target", "class"],
};

function markdownToSafeHtml(md) {
  const raw = marked.parse(String(md ?? ""));
  if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) {
    return DOMPurify.sanitize(raw, MD_SANITIZE);
  }
  return raw;
}

function hnCommentHtmlSafe(html) {
  const s = String(html ?? "");
  if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) {
    return DOMPurify.sanitize(s, COMMENT_SANITIZE);
  }
  return escapeHtml(s.replace(/<[^>]+>/g, ""));
}

let currentLang = localStorage.getItem(LS_PREF_LANG) || "en";
let activeCardId = null;
let currentActiveStory = null;
let currentPage = 1;
let hideReadActive = false;
let feedKind = localStorage.getItem(LS_FEED_KIND) || "daily";

const settingsModal = document.getElementById("settingsModal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const clearKeyBtn = document.getElementById("clearKeyBtn");
const notificationContainer = document.getElementById("notificationContainer");
const apiKeyInput = document.getElementById("apiKeyInput");

openSettingsBtn.addEventListener("click", () => {
  apiKeyInput.value = localStorage.getItem(LS_OPENAI_KEY) || "";
  settingsModal.showModal();
});
closeSettingsBtn.addEventListener("click", () => settingsModal.close());

saveKeyBtn.addEventListener("click", () => {
  if (apiKeyInput.value.trim()) {
    localStorage.setItem(LS_OPENAI_KEY, apiKeyInput.value.trim());
    settingsModal.close();
    if (currentActiveStory && activeCardId) {
      handleCardClick(
        currentActiveStory,
        document.getElementById(`card-${activeCardId}`),
      );
    }
  }
});

clearKeyBtn.addEventListener("click", () => {
  localStorage.removeItem(LS_OPENAI_KEY);
  apiKeyInput.value = "";
});

const langSelect = document.getElementById("langSelect");
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
  if (currentActiveStory && activeCardId) {
    const currentCard = document.getElementById(`card-${activeCardId}`);
    handleCardClick(currentActiveStory, currentCard);
  }
});

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
const sourceEmbedChecking = document.getElementById("sourceEmbedChecking");
const sourceEmbedError = document.getElementById("sourceEmbedError");
const readerSourceIframeWrap = document.getElementById(
  "readerSourceIframeWrap",
);
const readerSourceIframe = document.getElementById("readerSourceIframe");
let sourceEmbedRequestSeq = 0;
const readerCommentsToggleWrap = document.getElementById(
  "readerCommentsToggleWrap",
);
const readerHnBtn = document.getElementById("readerHnBtn");
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

function getFeedStorageKeys() {
  switch (feedKind) {
    case "daily":
      return { ids: LS_DAILY_IDS, time: LS_DAILY_TIME };
    case "weekly":
      return { ids: LS_WEEKLY_IDS, time: LS_WEEKLY_TIME };
    case "monthly":
      return { ids: LS_MONTHLY_IDS, time: LS_MONTHLY_TIME };
    default:
      return { ids: LS_DAILY_IDS, time: LS_DAILY_TIME };
  }
}

function getFeedListUrl() {
  return `/api/stories?period=${feedKind}`;
}

function syncFeedKindButtons() {
  if (feedKindDaily)
    feedKindDaily.classList.toggle("feed-kind-active", feedKind === "daily");
  if (feedKindWeekly)
    feedKindWeekly.classList.toggle("feed-kind-active", feedKind === "weekly");
  if (feedKindMonthly)
    feedKindMonthly.classList.toggle(
      "feed-kind-active",
      feedKind === "monthly",
    );

  if (feedKindDaily)
    feedKindDaily.setAttribute(
      "aria-pressed",
      feedKind === "daily" ? "true" : "false",
    );
  if (feedKindWeekly)
    feedKindWeekly.setAttribute(
      "aria-pressed",
      feedKind === "weekly" ? "true" : "false",
    );
  if (feedKindMonthly)
    feedKindMonthly.setAttribute(
      "aria-pressed",
      feedKind === "monthly" ? "true" : "false",
    );
}

function resetReaderForFeedSwitch() {
  activeCardId = null;
  currentActiveStory = null;
  feedList.querySelectorAll(".story-card.is-active").forEach((el) => {
    el.classList.remove("is-active");
  });
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
  loadStoriesClient(1);
  syncFeedKindButtons();
}

feedKindDaily.addEventListener("click", () => setFeedKind("daily"));
feedKindWeekly.addEventListener("click", () => setFeedKind("weekly"));
feedKindMonthly.addEventListener("click", () => setFeedKind("monthly"));
syncFeedKindButtons();

const SPINNER_SVG = `<svg class="animate-spin h-3.5 w-3.5 text-hn shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

function createFeedSkeletonCard() {
  const el = document.createElement("div");
  el.setAttribute("data-feed-skeleton", "1");
  el.className =
    "story-card bg-surface border border-borderSubtle p-4 rounded-xl shadow-sm flex flex-col justify-between";
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

function commentsThreadLoadingHTML() {
  return `<div class="hn-thread-loading px-3 py-4 space-y-4">
          <div class="flex items-center gap-2.5 text-xs font-mono text-textMuted">
            ${SPINNER_SVG}
            <span>Fetching thread…</span>
          </div>
          <div class="space-y-2.5">
            ${[1, 2, 3]
              .map(
                () => `<div class="rounded-lg border border-borderSubtle bg-surface/40 p-3 space-y-2">
              <div class="flex gap-2"><div class="ui-skeleton h-3 w-24 rounded"></div><div class="ui-skeleton h-3 w-12 rounded"></div></div>
              <div class="ui-skeleton h-3 rounded w-full"></div>
              <div class="ui-skeleton h-3 rounded" style="width:85%"></div>
            </div>`,
              )
              .join("")}
          </div>
        </div>`;
}

const hideReadToggle = document.getElementById("hideReadToggle");
const toggleKnob = document.getElementById("toggleKnob");

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

function timeAgo(unixTimestamp) {
  if (!unixTimestamp || isNaN(unixTimestamp)) return "recently";
  const seconds = Math.floor(
    (new Date() - new Date(unixTimestamp * 1000)) / 1000,
  );
  if (isNaN(seconds) || seconds < 0) return "recently";
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "y ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "mo ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "d ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "h ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "m ago";
  return Math.floor(seconds) + "s ago";
}

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
  const currentDayOfWeek = today.getDay();
  const numWeeks = 20;
  const totalDays = numWeeks * 7 + (currentDayOfWeek + 1);

  const daysArr = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    daysArr.push(`${year}-${month}-${day}`);
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

function getReadStories() {
  const a = safeJsonParse(localStorage.getItem(LS_READ_STORIES) || "[]", []);
  return Array.isArray(a) ? a : [];
}

function showNotification(message, type = 'error') {
  const notification = document.createElement('div');
  const bgColor = type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-amber-500' : 'bg-green-500';
  
  notification.className = `${bgColor} text-white px-4 py-3 rounded-lg shadow-lg pointer-events-auto transform transition-all duration-300 translate-y-0 opacity-100 mb-2`;
  notification.innerHTML = `
    <div class="flex items-center gap-3">
      <span class="w-2 h-2 rounded-full bg-white shrink-0"></span>
      <span class="text-sm font-medium">${message}</span>
    </div>
  `;
  
  notificationContainer.appendChild(notification);
  
  // Auto remove after 4 seconds
  setTimeout(() => {
    notification.classList.remove('translate-y-0', 'opacity-100');
    notification.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);
}

function markAsRead(id) {
  const read = getReadStories();
  const n = Number(id);
  if (!read.some((x) => Number(x) === n)) {
    read.push(n);
    localStorage.setItem(LS_READ_STORIES, JSON.stringify(read));

    const stats = getReadStats();
    const todayDate = new Date();
    const year = todayDate.getFullYear();
    const month = String(todayDate.getMonth() + 1).padStart(2, "0");
    const day = String(todayDate.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    stats[todayStr] = (stats[todayStr] || 0) + 1;
    localStorage.setItem(LS_READ_STATS, JSON.stringify(stats));

    renderActivityGraph();
  }
}

function isRead(id) {
  const n = Number(id);
  return getReadStories().some((x) => Number(x) === n);
}

function applyReadState(story, cardElement) {
  cardElement.classList.add("is-read");
  const icon = cardElement.querySelector(".check-icon");
  if (icon) icon.classList.replace("hidden", "block");
  markAsRead(story.id);
}

const COMMENTS_OPEN_PREF_KEY = "github_trending_digest_comments_open_v1";
const SOURCE_OPEN_PREF_KEY = "github_trending_digest_source_open_v1";

function getCommentsOpenPreference() {
  return localStorage.getItem(COMMENTS_OPEN_PREF_KEY) === "1";
}

function setCommentsOpenPreference(open) {
  localStorage.setItem(COMMENTS_OPEN_PREF_KEY, open ? "1" : "0");
}

function getSourceOpenPreference() {
  return localStorage.getItem(SOURCE_OPEN_PREF_KEY) === "1";
}

function setSourceOpenPreference(open) {
  localStorage.setItem(SOURCE_OPEN_PREF_KEY, open ? "1" : "0");
}

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

function setSourceExternalHrefs(href) {
  sourceFramePanel.querySelectorAll("a.js-source-external").forEach((a) => {
    a.href = href;
  });
}

function closeSourcePanel(persistPreference) {
  sourceEmbedRequestSeq += 1;
  sourceFramePanel.classList.add("hidden");
  sourceFramePanel.setAttribute("hidden", "");
  readerBody.classList.remove("hidden");
  readerSourceIframe.removeAttribute("src");
  sourceEmbedChecking.classList.add("hidden");
  sourceEmbedError.classList.add("hidden");
  readerSourceIframeWrap.classList.remove("hidden");
  if (persistPreference) setSourceOpenPreference(false);
  syncReaderViewToggleUi();
}

// Cache for README content to avoid repeated API calls
const readmeCache = new Map();
const README_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function resolveReadmeImages(markdown, fullName, defaultBranch = "main") {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;

  return (
    markdown
      // Markdown syntax: ![alt](./image.png) or ![alt](image.png)
      .replace(
        /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
        (match, alt, src) => {
          const cleaned = src.replace(/^\.\//, "");
          return `![${alt}](${base}/${cleaned})`;
        },
      )
      // HTML syntax: <img src="./image.png"> or <img src="image.png">
      .replace(
        /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
        (match, before, src, after) => {
          const cleaned = src.replace(/^\.\//, "");
          return `<img${before} src="${base}/${cleaned}"${after}>`;
        },
      )
      // HTML syntax with single quotes src=''
      .replace(
        /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
        (match, before, src, after) => {
          const cleaned = src.replace(/^\.\//, "");
          return `<img${before} src="${base}/${cleaned}"${after}>`;
        },
      )
  );
}

async function openSourcePanelForStory(story, persistPreference) {
  if (!story?.id) return;

  sourceFramePanel.classList.remove("hidden");
  sourceFramePanel.classList.add("flex");
  sourceFramePanel.scrollTop = 0;

  // Hide iframe, use wrap div instead
  readerSourceIframe.style.display = "none";

  // Check cache first
  const cacheKey = story.id;
  const cached = readmeCache.get(cacheKey);
  const now = Date.now();
  
  if (cached && (now - cached.time) < README_CACHE_TTL) {
    // Use cached content
    renderReadmeContent(cached.data, story);
    if (persistPreference) setSourceOpenPreference(true);
    syncReaderViewToggleUi();
    return;
  }

  // Clear old content and create new div
  let readmeDiv = readerSourceIframeWrap.querySelector(".readme-render");
  if (!readmeDiv) {
    readmeDiv = document.createElement("div");
    readmeDiv.className = "readme-render";
    readmeDiv.style.cssText = `
      height: 100%; overflow-y: auto; padding: 1.5rem;
      color: #e4e4e7; font-family: 'Geist Sans', sans-serif;
      line-height: 1.7; font-size: 0.9375rem;
      background: #0c0c0e;
    `;
    readerSourceIframeWrap.appendChild(readmeDiv);
  }

  // Show loading
  readmeDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:2rem;color:#71717a;">
      <svg style="width:1rem;height:1rem;animation:spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle style="opacity:0.2" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path style="opacity:0.8" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <span style="font-size:0.8125rem;">Loading README...</span>
    </div>`;

  try {
    const res = await fetch(`/api/repo?id=${encodeURIComponent(story.id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Cache the result
    readmeCache.set(cacheKey, {
      data: data,
      time: now
    });

    renderReadmeContent(data, story);

  } catch (err) {
    console.error("README load failed:", err);
    renderReadmeError(err, story);
  }

  if (persistPreference) setSourceOpenPreference(true);
  syncReaderViewToggleUi();
}

function renderReadmeContent(data, story) {
  // Clear old content and create new div
  let readmeDiv = readerSourceIframeWrap.querySelector(".readme-render");
  if (!readmeDiv) {
    readmeDiv = document.createElement("div");
    readmeDiv.className = "readme-render";
    readmeDiv.style.cssText = `
      height: 100%; overflow-y: auto; padding: 1.5rem;
      color: #e4e4e7; font-family: 'Geist Sans', sans-serif;
      line-height: 1.7; font-size: 0.9375rem;
      background: #0c0c0e;
    `;
    readerSourceIframeWrap.appendChild(readmeDiv);
  }

  const fullName = data.raw_api_response?.full_name || story.id;
  const branch = data.raw_api_response?.default_branch || "main";
  const md = resolveReadmeImages(
    data.readme_content || "*No README available.*",
    fullName,
    branch,
  );
  const html =
    typeof marked !== "undefined" ? marked.parse(md) : markdownToSafeHtml(md);

  readmeDiv.innerHTML = `
    <style>
      .readme-render h1,.readme-render h2,.readme-render h3,.readme-render h4 {
        color:#fff;font-weight:600;margin:1.5rem 0 0.75rem;
        padding-bottom:0.4rem;border-bottom:1px solid #27272a;
      }
      .readme-render h1{font-size:1.4rem;} .readme-render h2{font-size:1.2rem;}
      .readme-render h3{font-size:1.05rem;} .readme-render h4{font-size:0.95rem;}
      .readme-render p{margin:0 0 1rem;color:#d4d4d8;}
      .readme-render a{color:#60a5fa;text-decoration:underline;}
      .readme-render a:hover{color:#93c5fd;}
      .readme-render ul,.readme-render ol{color:#d4d4d8;padding-left:1.5rem;margin:0 0 1rem;}
      .readme-render li{margin-bottom:0.25rem;}
      .readme-render blockquote{border-left:3px solid #3f3f46;margin:1rem 0;padding:0.75rem 1rem;
        background:#18181b;border-radius:0.375rem;color:#a1a1aa;}
      .readme-render code{font-family:'Geist Mono',monospace;font-size:0.8125rem;
        background:#27272a;color:#fbbf24;padding:0.1rem 0.35rem;border-radius:0.25rem;}
      .readme-render pre{background:#18181b;border:1px solid #27272a;border-radius:0.5rem;
        padding:1rem;overflow-x:auto;margin:1rem 0;}
      .readme-render pre code{background:transparent;color:#e4e4e7;padding:0;}
      .readme-render img{max-width:100%;border-radius:0.5rem;border:1px solid #27272a;margin:1rem 0;}
      .readme-render table{border-collapse:collapse;width:100%;margin:1rem 0;}
      .readme-render th,.readme-render td{border:1px solid #27272a;padding:0.5rem 0.75rem;color:#d4d4d8;}
      .readme-render th{background:#27272a;color:#fff;font-weight:600;}
      .readme-render hr{border:none;border-top:1px solid #27272a;margin:1.5rem 0;}
      @keyframes spin{to{transform:rotate(360deg);}}
    </style>
    <div class="readme-render">${DOMPurify.sanitize(html, MD_SANITIZE)}</div>
  `;

  // Open links in new tab
  readmeDiv.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

function renderReadmeError(err, story) {
  let readmeDiv = readerSourceIframeWrap.querySelector(".readme-render");
  if (!readmeDiv) {
    readmeDiv = document.createElement("div");
    readmeDiv.className = "readme-render";
    readmeDiv.style.cssText = `
      height: 100%; overflow-y: auto; padding: 1.5rem;
      color: #e4e4e7; font-family: 'Geist Sans', sans-serif;
      line-height: 1.7; font-size: 0.9375rem;
      background: #0c0c0e;
    `;
    readerSourceIframeWrap.appendChild(readmeDiv);
  }

  readmeDiv.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:300px;gap:1rem;text-align:center;color:#71717a;">
      <svg style="width:2rem;height:2rem;color:#52525b;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p style="font-size:0.875rem;">Failed to load README</p>
      <p style="font-size:0.75rem;">${err.message}</p>
      <a href="${story.url}" target="_blank" rel="noopener noreferrer"
        style="color:#ff8533;font-size:0.8125rem;text-decoration:underline;">
        View on GitHub ↗
      </a>
    </div>`;
}

function toggleSourcePanelFromUi() {
  if (!currentActiveStory?.id) return;
  const open = !sourceFramePanel.classList.contains("hidden");
  if (open) closeSourcePanel(true);
  else void openSourcePanelForStory(currentActiveStory, true);
}

function syncCommentsButtonUi() {
  const open = !commentsPane.classList.contains("hidden");
  readerHnBtn.classList.toggle("feed-kind-active", open);
  readerHnBtn.setAttribute("aria-pressed", open ? "true" : "false");
}

function openCommentsPanelForStory(story, persistPreference) {
  if (!story) return;
  commentsPane.classList.remove("hidden");
  commentsPane.classList.add("flex");
  if (window.innerWidth < 768) {
    commentsBackdrop.classList.remove("hidden");
  }
  commentsExternalLink.href = `${story.url}/issues`;
  loadGitHubIssues(story.id, commentsBody);
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

function visibleFeedCards() {
  return Array.from(
    feedList.querySelectorAll(".story-card[id^='card-']"),
  ).filter((el) => el.offsetParent !== null);
}

function keyboardInFormField() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (a.isContentEditable) return true;
  return false;
}

function shouldArrowNavigateFeed() {
  if (keyboardInFormField()) return false;
  const a = document.activeElement;
  if (readerBody.contains(a)) return false;
  if (commentsBody.contains(a)) return false;
  return true;
}

function navigateFeedByArrow(delta) {
  const cards = visibleFeedCards();
  if (!cards.length) return;
  let idx = cards.findIndex((c) => c.id === `card-${activeCardId}`);
  if (idx === -1) {
    idx = delta > 0 ? -1 : cards.length;
  }
  const next = Math.max(0, Math.min(cards.length - 1, idx + delta));
  if (next === idx) return;
  const card = cards[next];
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.click();
}

function toggleCommentsKeyboard() {
  if (!currentActiveStory) return;
  const open = !commentsPane.classList.contains("hidden");
  if (open) closeCommentsPanel(true);
  else openCommentsPanelForStory(currentActiveStory, true);
}

function openCurrentStoryInNewTab() {
  if (!currentActiveStory?.url) return;
  let href = "";
  try {
    const u = new URL(currentActiveStory.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    href = u.href;
  } catch {
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

document.addEventListener("keydown", (e) => {
  if (settingsModal.open) return;

  if (keyboardInFormField()) return;

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

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && shouldArrowNavigateFeed()) {
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
    if (!currentActiveStory?.url) return;
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
    if (!currentActiveStory?.url) return;
    e.preventDefault();
    openCurrentStoryInNewTab();
  }
});

readerViewSummaryBtn.addEventListener("click", async () => {
  if (!currentActiveStory?.url) return;
  if (!sourceFramePanel.classList.contains("hidden")) {
    closeSourcePanel(true);
    // Load summary when switching from README to Summary
    await loadSummaryForStory(currentActiveStory);
  }
});

readerViewSourceBtn.addEventListener("click", () => {
  if (!currentActiveStory?.url) return;
  if (sourceFramePanel.classList.contains("hidden")) {
    // Hide summary content when showing README
    readerBody.classList.add("hidden");
    void openSourcePanelForStory(currentActiveStory, true);
  }
});

readerHnBtn.addEventListener("click", () => {
  if (!currentActiveStory) return;
  toggleCommentsKeyboard();
});

const HN_ITEM_CACHE_KEY = "github_trending_digest_hn_items_v1";
const HN_ITEM_CACHE_MAX = 1000;
const HN_ITEM_CACHE_TTL_MS = 45 * 60 * 1000;

function hnItemCacheLoad() {
  try {
    const raw = localStorage.getItem(HN_ITEM_CACHE_KEY);
    if (!raw) return { items: {}, order: [] };
    const o = JSON.parse(raw);
    if (!o || typeof o.items !== "object" || !Array.isArray(o.order)) {
      return { items: {}, order: [] };
    }
    return o;
  } catch {
    return { items: {}, order: [] };
  }
}

function hnItemCacheSave(cache) {
  try {
    localStorage.setItem(HN_ITEM_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    const half = Math.floor(cache.order.length / 2);
    for (let i = 0; i < half; i++) {
      const v = cache.order.shift();
      if (v) delete cache.items[v];
    }
    try {
      localStorage.setItem(HN_ITEM_CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* ignore */
    }
  }
}

function hnItemCacheGet(id) {
  const sid = String(id);
  const cache = hnItemCacheLoad();
  const entry = cache.items[sid];
  if (!entry) return null;
  if (Date.now() - entry.t > HN_ITEM_CACHE_TTL_MS) {
    delete cache.items[sid];
    cache.order = cache.order.filter((x) => x !== sid);
    hnItemCacheSave(cache);
    return null;
  }
  return entry.data;
}

function hnItemCacheSet(id, data) {
  const sid = String(id);
  const cache = hnItemCacheLoad();
  const existed = !!cache.items[sid];
  cache.items[sid] = { t: Date.now(), data };
  if (!existed) {
    cache.order.push(sid);
    while (cache.order.length > HN_ITEM_CACHE_MAX) {
      const victim = cache.order.shift();
      if (victim) delete cache.items[victim];
    }
  }
  hnItemCacheSave(cache);
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

async function fetchHnItem(id) {
  const cached = hnItemCacheGet(id);
  if (cached !== null) return cached;
  const res = await fetch(
    `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
  );
  const data = await res.json();
  hnItemCacheSet(id, data);
  return data;
}

function hnCommentBlock(item, depth) {
  const block = document.createElement("div");
  block.className = "hn-comment-block";
  block.dataset.depth = String(depth);
  block.dataset.rail = String(depth % 5);

  const article = document.createElement("article");
  article.className = "hn-comment-card";

  const rail = document.createElement("div");
  rail.className = "hn-comment-rail";
  rail.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "hn-comment-inner";

  const meta = document.createElement("header");
  meta.className = "hn-comment-meta w-full";

  const author = document.createElement("span");
  author.className = "hn-comment-author";
  author.textContent = item.by || "[deleted]";
  meta.appendChild(author);

  if (item.time) {
    const when = document.createElement("span");
    when.className = "hn-comment-time";
    when.textContent = timeAgo(item.time);
    meta.appendChild(when);
  }

  if (depth > 0) {
    const depthBadge = document.createElement("span");
    depthBadge.className = "hn-comment-depth shrink-0 ml-auto";
    depthBadge.textContent = `L${depth}`;
    depthBadge.title = `Reply depth ${depth}`;
    meta.appendChild(depthBadge);
  }

  const body = document.createElement("div");
  body.className = "hn-comment-body";
  body.innerHTML = hnCommentHtmlSafe(item.text || "");
  applyBlankTargets(body);

  inner.appendChild(meta);
  inner.appendChild(body);
  article.appendChild(rail);
  article.appendChild(inner);
  block.appendChild(article);

  let replies = null;
  if (item.kids && item.kids.length > 0) {
    replies = document.createElement("div");
    replies.className = "hn-replies";
    if (depth === 0) replies.classList.add("hn-replies--root");
    block.appendChild(replies);
  }

  return { block, replies };
}

async function loadGitHubIssues(repoId, container) {
  container.innerHTML = `
          <div class="flex items-center justify-center py-8">
            <div class="animate-spin h-4 w-4 border-2 border-hn border-t-transparent rounded-full"></div>
            <span class="ml-2 text-sm text-textMuted">Loading issues...</span>
          </div>
        `;

  try {
    // Parse repoId from "owner/repo" format
    const [owner, repo] = repoId.split("/");
    if (!owner || !repo) {
      container.innerHTML =
        '<p class="text-sm text-textMuted px-2 py-10 text-center">Invalid repository format.</p>';
      return;
    }

    // Fetch GitHub issues
    const issuesRes = await fetch(`/api/issues?owner=${owner}&repo=${repo}`);
    if (!issuesRes.ok) {
      throw new Error(`Failed to fetch issues: ${issuesRes.status}`);
    }

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
                <a href="${data.repo_url}/issues" target="_blank" class="text-xs text-hn hover:underline">
                  View on GitHub ↗
                </a>
              </div>
            `;
      return;
    }
    // Render issues
    container.innerHTML = "";
    const listRoot = document.createElement("div");
    listRoot.className = "space-y-4";

    issues.forEach((issue) => {
      const issueEl = document.createElement("div");
      issueEl.className =
        "border border-borderSubtle rounded-lg p-4 hover:bg-surfaceHover transition-colors";

      const labels = issue.labels
        ? issue.labels
            .map(
              (label) =>
                `<span class="inline-block px-2 py-1 text-xs rounded-full" style="background-color: ${label.color}20; color: ${label.color}">${label.name}</span>`,
            )
            .join(" ")
        : "";

      issueEl.innerHTML = `
              <div class="flex items-start justify-between mb-2">
                <h3 class="font-medium text-sm text-textMain">
                  <a href="${issue.html_url}" target="_blank" class="hover:text-hn transition-colors">
                    ${issue.title}
                  </a>
                </h3>
                <span class="text-xs text-textMuted">#${issue.number}</span>
              </div>
              <div class="flex items-center gap-4 text-xs text-textMuted mb-2">
                <span>👤 ${issue.user.login}</span>
                <span>💬 ${issue.comments}</span>
                <span>⏰ ${new Date(issue.created_at).toLocaleDateString()}</span>
                ${issue.state === "open" ? '<span class="text-green-500">🟢 Open</span>' : '<span class="text-red-500">🔴 Closed</span>'}
              </div>
              ${labels ? `<div class="flex flex-wrap gap-1">${labels}</div>` : ""}
            `;

      listRoot.appendChild(issueEl);
    });

    container.appendChild(listRoot);

    // Add footer link
    const footerEl = document.createElement("div");
    footerEl.className = "text-center py-4 border-t border-borderSubtle mt-4";
    footerEl.innerHTML = `
            <a href="${data.repo_url}/issues" target="_blank" class="text-xs text-hn hover:underline">
              View all issues on GitHub ↗
            </a>
          `;
    container.appendChild(footerEl);
  } catch (error) {
    console.error("Failed to load GitHub issues:", error);
    container.innerHTML = `
            <div class="text-center py-8">
              <p class="text-sm text-textMuted mb-2">Failed to load issues</p>
              <button onclick="loadGitHubIssues('${repoId}', this.parentElement)" class="text-xs text-hn hover:underline">
                Retry ↻
              </button>
            </div>
          `;
  }
}

// GitHub Issues functionality implemented above

mobileBackBtn.addEventListener("click", () => {
  closeCommentsPanel(false);
  feedPane.classList.remove("hidden");
  readerPane.classList.add("hidden");
  readerPane.classList.remove("flex");
});

loadMoreBtn.addEventListener("click", () => {
  currentPage++;
  loadStoriesClient(currentPage);
});

async function loadStoriesClient(page = 1) {
  let loadMoreEnabled = false;
  let loadMoreLabel = "Load More";

  loadMoreBtn.disabled = true;
  loadMoreBtn.innerHTML = `${SPINNER_SVG}<span>Loading…</span>`;

  if (page > 1) {
    for (let i = 0; i < 3; i++) {
      feedList.appendChild(createFeedSkeletonCard());
    }
  } else {
    feedList
      .querySelectorAll("[data-feed-skeleton]")
      .forEach((el) => el.remove());

    if (page === 1) {
      feedList.innerHTML = "";
      loadMoreBtn.classList.remove("hidden");
      loadMoreBtn.textContent = loadMoreLabel;
      loadMoreBtn.disabled = false;
    } else {
      loadMoreBtn.textContent = loadMoreLabel;
      loadMoreBtn.disabled = false;
    }

    try {
      const apiUrl = `/api/stories?period=${feedKind}&page=${page}`;
      const res = await fetch(apiUrl);
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (page === 1) {
        feedList.innerHTML = "";
      }

      renderStoriesFromIds(data.stories || []);
      loadMoreEnabled = data.hasMore;
    } catch (e) {
      console.error("Load stories error:", e);
      if (page === 1) {
        feedList.innerHTML = `
                <div class="col-span-full text-center py-8 text-textMuted">
                  <p class="mb-2">Failed to load repositories</p>
                  <button
                    type="button"
                    onclick="location.reload()"
                    class="px-4 py-2 bg-hn text-white rounded-lg hover:bg-hn/90 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              `;
      } else {
        loadMoreBtn.textContent = "Failed to load";
        loadMoreBtn.disabled = true;
      }
    }

    if (loadMoreEnabled) {
      loadMoreBtn.classList.remove("hidden");
    } else {
      loadMoreBtn.classList.add("hidden");
    }
  }

  function renderStoriesFromIds(stories) {
    const frag = document.createDocumentFragment();
    stories.forEach((story, i) => {
      const card = document.createElement("div");
      card.style.animationDelay = `${i * 20}ms`;
      card.id = `card-${story.id}`;

      const readClass = isRead(story.id) ? "is-read" : "";
      const activeClass = activeCardId === story.id ? "is-active" : "";

      card.className = `story-card bg-surface border border-borderSubtle p-4 rounded-xl hover:bg-surfaceHover hover:border-borderHover cursor-pointer flex flex-col justify-between group animate-fade-in opacity-0 shadow-sm ${readClass} ${activeClass}`;

      let domain = "github.com";
      if (story.url) {
        try {
          domain = new URL(story.url).hostname;
        } catch {
          domain = "github.com";
        }
      }
      const relativeTime = timeAgo(story.time);

      let scoreColor = "text-textMuted";
      let scoreBg = "bg-appBg";
      let scoreBorder = "border-borderSubtle";
      if (story.score > 500) {
        scoreColor = "text-hn";
        scoreBg = "bg-hn/10";
        scoreBorder = "border-hn/20";
      } else if (story.score > 100) {
        scoreColor = "text-amber-500";
        scoreBg = "bg-amber-500/10";
        scoreBorder = "border-amber-500/20";
      }

      const titleSafe = escapeHtml(story.title);

      card.innerHTML = `
                        <div class="flex justify-between items-start mb-3">
                            <h3 class="font-medium text-[14px] leading-snug text-textMain group-hover:text-white transition-colors pr-2">${titleSafe}</h3>
                            <div class="check-icon ${
                              activeCardId === story.id
                                ? "opacity-100"
                                : "opacity-0"
                            } group-hover:opacity-100 transition-opacity duration-200 text-textMuted">
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                        </div>
                        <div class="text-sm text-textMuted leading-snug mb-3 line-clamp-2">${escapeHtml(story.description || "")}</div>
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3 text-xs">
                                <div class="flex items-center gap-1.5">
                                    <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                    </svg>
                                    <span class="${scoreColor}">${story.score}</span>
                                </div>
                                ${
                                  story.language
                                    ? `
                                <div class="flex items-center gap-1.5">
                                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                                    </svg>
                                    <span class="font-mono">${story.language}</span>
                                </div>
                                `
                                    : ""
                                }
                                <div class="flex items-center gap-1.5">
                                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                                    </svg>
                                    <span class="font-mono">${domain}</span>
                                </div>
                            </div>
                            <div class="flex items-center gap-1.5 text-xs text-textMuted">
                                <span>${relativeTime}</span>
                            </div>
                        </div>
                    `;

      card.addEventListener("click", () => handleCardClick(story, card));
      frag.appendChild(card);
    });
    feedList.appendChild(frag);

    loadMoreEnabled = true;
    loadMoreLabel = "Load More";

    if (page === 1) {
      statusDot.classList.remove("animate-pulse");
      statusTextEl.textContent = "Live";
    }
  }
}

function summaryStatusLangSuffix() {
  return currentLang === "en" ? "" : ` (${currentLang.toUpperCase()})`;
}

async function handleCardClick(story, cardElement) {
  if (activeCardId) {
    const oldCard = document.getElementById(`card-${activeCardId}`);
    if (oldCard) oldCard.classList.remove("is-active");
  }
  activeCardId = story.id;
  currentActiveStory = story;

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
    openCommentsPanelForStory(story, false);
  } else {
    closeCommentsPanel(false);
  }

  closeSourcePanel(false);
  setReaderViewToggleVisible(false);

  readerBody.classList.remove("animate-reader-in", "opacity-50");
  readerTitle.textContent = story.title;
  readerBody.innerHTML = "";

  let sourceUrlOk = false;
  let sourceHrefForStory = "";
  if (story.url) {
    try {
      const u = new URL(story.url);
      if (u.protocol === "http:" || u.protocol === "https:") {
        sourceHrefForStory = u.href;
        setSourceExternalHrefs(u.href);
        sourceUrlOk = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (sourceUrlOk) {
    readerTitleSourceLink.href = sourceHrefForStory;
    readerTitleSourceLink.textContent = sourceHrefForStory;
    readerTitleSourceLink.classList.remove("hidden");
  } else {
    readerTitleSourceLink.removeAttribute("href");
    readerTitleSourceLink.textContent = "";
    readerTitleSourceLink.classList.add("hidden");
  }

  if (sourceUrlOk) {
    setReaderViewToggleVisible(true);
    if (getSourceOpenPreference()) {
      await openSourcePanelForStory(story, false);
    } else {
      syncReaderViewToggleUi();
    }
  }

  // Show GitHub Issues section
  readerCommentsToggleWrap.classList.remove("hidden");
  commentsExternalLink.href = `${story.url}/issues`;
  loadGitHubIssues(story.id, commentsBody);

  readerContent.scrollTop = 0;

  // Load summary
  await loadSummaryForStory(story);
}

async function loadSummaryForStory(story) {
  const localCacheKey = `summary_${story.id}_${currentLang}`;
  const browserCachedSummary = localStorage.getItem(localCacheKey);

  if (browserCachedSummary) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-hn shrink-0"></span><span class="uppercase tracking-wider">Loaded from cache${summaryStatusLangSuffix()}</span></span>`;
    readerBody.innerHTML = markdownToSafeHtml(browserCachedSummary);
    applyBlankTargets(readerBody);
    readerBody.classList.remove("hidden");
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");
    return;
  }

  readerBody.classList.remove("hidden");
  readerBody.classList.add("opacity-50");
  readerBody.innerHTML = readerSummarySkeletonHTML();
  readerStatus.innerHTML = `<span class="flex items-center gap-2">${SPINNER_SVG}<span class="uppercase tracking-wider">Generating summary</span></span>`;

  try {
    const apiKey = (localStorage.getItem(LS_OPENAI_KEY) || "").trim();
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(
      `/api/summarize?id=${encodeURIComponent(
        story.id,
      )}&lang=${encodeURIComponent(currentLang)}`,
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
        </div>
      `;
      readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">Add API key in settings</span></span>`;
      return;
    }
    if (!res.ok) {
      throw new Error(data.error || "Summary request failed");
    }
    const summary = data.summary;
    if (!summary) throw new Error("Empty summary");

    const statusLabel = data.cached
      ? `Server cache${summaryStatusLangSuffix()}`
      : `Generated${summaryStatusLangSuffix()}`;
    const dotClass = data.cached ? "bg-hn" : "bg-green-500";
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${dotClass} shrink-0"></span><span class="uppercase tracking-wider">${statusLabel}</span></span>`;
    readerBody.classList.remove("opacity-50");
    readerBody.innerHTML = markdownToSafeHtml(summary);
    applyBlankTargets(readerBody);
    void readerBody.offsetWidth;
    readerBody.classList.add("animate-reader-in");

    try {
      localStorage.setItem(localCacheKey, summary);
    } catch (e) {
      console.warn("Local storage full, skipping browser cache.");
    }

    // Apply read state to the active card
    const activeCard = document.getElementById(`card-${story.id}`);
    if (activeCard) {
      applyReadState(story, activeCard);
    }
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
      </div>
    `;
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider text-[10px] leading-snug">Summary failed — check API key</span></span>`;
  }
}

renderActivityGraph();
loadStoriesClient();
