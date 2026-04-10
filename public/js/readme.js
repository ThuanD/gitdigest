import { MD_SANITIZE } from "./constants.js";
import { resolveReadmeImages } from "./utils.js";
import { sourceFramePanel, readerSourceIframeWrap, readerBody, readerStatus } from "./dom.js";

const README_CACHE_TTL = 30 * 60 * 1000;
const readmeCache = new Map();

// ─── Shadow DOM helpers ───────────────────────────────────────────────────────
function getOrCreateReadmeHost() {
  let host = readerSourceIframeWrap.querySelector(".readme-shadow-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "readme-shadow-host";
    host.style.cssText = "width:100%;height:100%;overflow-y:auto;";
    readerSourceIframeWrap.appendChild(host);
  }
  return host;
}

function getOrCreateShadowRoot(host) {
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}

// ─── Style factories ──────────────────────────────────────────────────────────
function readmeStyles() {
  return `<style>
    :host { display:block; color:#e4e4e7; font-family:'Geist Sans',sans-serif; line-height:1.7; font-size:0.9375rem; background:#0c0c0e; padding:1.5rem; box-sizing:border-box; }
    h1,h2,h3,h4,h5,h6 { color:#fff !important; border-bottom-color:#27272a !important; font-weight:600; margin:1.5rem 0 0.75rem; padding-bottom:0.4rem; }
    h1{font-size:1.4rem} h2{font-size:1.2rem} h3{font-size:1.05rem} h4{font-size:0.95rem}
    p { color:#d4d4d8 !important; margin:0 0 1rem; }
    a { color:#60a5fa !important; text-decoration:underline; } a:hover { color:#93c5fd !important; }
    a img[src*="shields.io"],a img[alt*="badge"]{ display:inline !important; vertical-align:middle !important; margin:0 2px !important; }
    div[align="center"],div[align="center"] p { text-align:center !important; }
    div[align="center"] a { display:inline !important; margin:0 2px !important; }
    div[align="center"] a img,div[align="center"] p a img,p>a>img[src*="shields.io"],p>a>img[src*="badge"],p>a>img[src*="camo.githubusercontent"] { display:inline !important; vertical-align:middle !important; max-width:none !important; border:none !important; border-radius:0 !important; margin:2px !important; }
    code { font-family:'Geist Mono',monospace; font-size:0.8125rem; background-color:#27272a !important; color:#fbbf24 !important; padding:0.1rem 0.35rem; border-radius:0.25rem; }
    pre { background-color:#18181b !important; border:1px solid #27272a !important; border-radius:0.5rem; padding:1rem; overflow-x:auto; margin:1rem 0; }
    pre code { background:transparent !important; color:#e4e4e7 !important; padding:0; }
    blockquote { border-left:3px solid #3f3f46 !important; margin:1rem 0; padding:0.75rem 1rem; background-color:#18181b !important; border-radius:0.375rem; color:#a1a1aa !important; }
    table { border-collapse:collapse; width:100%; margin:1rem 0; border-color:#27272a !important; }
    th,td { border:1px solid #27272a !important; padding:0.5rem 0.75rem; color:#d4d4d8 !important; }
    th { background-color:#27272a !important; color:#fff !important; font-weight:600; }
    hr { border:none; border-top:1px solid #27272a !important; margin:1.5rem 0; }
    img { max-width:100%; border-radius:0.5rem; border:1px solid #27272a !important; margin:1rem 0; }
    ul,ol { color:#d4d4d8 !important; padding-left:1.5rem; margin:0 0 1rem; }
    li { margin-bottom:0.25rem; }
  </style>`;
}

function loadingStyles() {
  return `<style>:host{display:flex;align-items:center;justify-content:center;min-height:100%;gap:0.75rem;padding:2rem;color:#71717a;font-family:'Geist Sans',sans-serif;background:#0c0c0e;box-sizing:border-box;}@keyframes spin{to{transform:rotate(360deg)}}.spinner{width:1rem;height:1rem;animation:spin 1s linear infinite;}</style>`;
}

function errorStyles() {
  return `<style>:host{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;gap:1rem;text-align:center;color:#71717a;font-family:'Geist Sans',sans-serif;background:#0c0c0e;box-sizing:border-box;padding:2rem;} a{color:#ff8533;text-decoration:underline;} .error-text{font-size:0.875rem;} .error-detail{font-size:0.75rem;}</style>`;
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function getReadmeHtml(data, repo) {
  if (data.readmeHtml) return data.readmeHtml;
  const fullName = data.rawApiResponse?.fullName || repo.id;
  const branch = data.rawApiResponse?.defaultBranch || "main";
  const md = resolveReadmeImages(
    data.readmeContent || "*No README available.*",
    fullName,
    branch,
  );
  return typeof marked !== "undefined" ? marked.parse(md) : md;
}

function processReadmeLinks(shadowRoot) {
  shadowRoot.querySelectorAll(".readme-content a[href]").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
}

function renderReadmeContent(data, repo) {
  const host = getOrCreateReadmeHost();
  const sr = getOrCreateShadowRoot(host);
  const html = getReadmeHtml(data, repo);
  sr.innerHTML =
    readmeStyles() +
    `<div class="readme-content">${DOMPurify.sanitize(html, MD_SANITIZE)}</div>`;
  processReadmeLinks(sr);
  
  // Update status to show source loaded
  if (readerStatus) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span><span class="uppercase tracking-wider">Source loaded</span></span>`;
  }
}

function renderReadmeError(err, repo) {
  const host = getOrCreateReadmeHost();
  const sr = getOrCreateShadowRoot(host);

  let msg = "Failed to load README",
    hint = "";
  if (err.message?.includes("403")) {
    msg = "GitHub API rate limit exceeded";
    hint = "Please wait a few minutes before trying again.";
  } else if (err.message?.includes("404")) {
    msg = "Repository not found";
    hint = "The repository may have been deleted or moved.";
  } else if (err.message?.includes("401")) {
    msg = "Authentication failed";
    hint = "Check your GitHub token configuration.";
  }

  sr.innerHTML =
    errorStyles() +
    `
    <div class="text-center py-8">
      <svg class="w-12 h-12 mb-4 text-borderSubtle mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p class="text-sm text-textMuted mb-2">${msg}</p>
      ${hint ? `<p class="text-xs text-textMuted mb-3">${hint}</p>` : ""}
      <a href="${repo.url}" target="_blank" rel="noopener noreferrer" class="text-xs text-hn hover:underline">View on GitHub</a>
    </div>`;
    
  // Update status to show error
  if (readerStatus) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><span class="uppercase tracking-wider">Source error</span></span>`;
  }
}

// ─── Panel open/close ─────────────────────────────────────────────────────────
export function syncReaderViewToggleUi(
  readerViewSummaryBtn,
  readerViewSourceBtn,
) {
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

export function closeSourcePanel(persist, deps) {
  sourceFramePanel.classList.add("hidden");
  sourceFramePanel.setAttribute("hidden", "");
  readerBody.classList.remove("hidden");
  document.getElementById("readerChat")?.classList.remove("hidden");
  readerSourceIframeWrap.classList.remove("hidden");
  if (persist) deps.setSourceOpenPref(false);
  syncReaderViewToggleUi(deps.readerViewSummaryBtn, deps.readerViewSourceBtn);
  
  // Reset status to loading for summary view
  if (readerStatus) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span><span class="uppercase tracking-wider">Loading</span></span>`;
  }
}

export async function openSourcePanel(repo, persist, deps) {
  if (!repo?.id) return;

  sourceFramePanel.classList.remove("hidden");
  readerBody.classList.add("hidden");
  document.getElementById("readerChat")?.classList.add("hidden");
  readerSourceIframeWrap.classList.remove("hidden");
  sourceFramePanel.removeAttribute("hidden");

  if (persist) deps.setSourceOpenPref(true);
  syncReaderViewToggleUi(deps.readerViewSummaryBtn, deps.readerViewSourceBtn);

  const cached = readmeCache.get(repo.id);
  if (cached && Date.now() - cached.time < README_CACHE_TTL) {
    renderReadmeContent(cached.data, repo);
    return;
  }

  // Set loading status only if not cached
  if (readerStatus) {
    readerStatus.innerHTML = `<span class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span><span class="uppercase tracking-wider">Loading source</span></span>`;
  }

  // Loading state
  const host = getOrCreateReadmeHost();
  const sr = getOrCreateShadowRoot(host);
  sr.innerHTML =
    loadingStyles() +
    `
    <svg class="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle style="opacity:0.2" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path style="opacity:0.8" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
    <span style="font-size:0.8125rem;">Loading README...</span>`;

  try {
    const res = await fetch(`/api/repo?repoId=${encodeURIComponent(repo.id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    readmeCache.set(repo.id, { data, time: Date.now() });
    renderReadmeContent(data, repo);
  } catch (err) {
    console.error("README load failed:", err);
    renderReadmeError(err, repo);
  }
}
