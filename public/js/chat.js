import {
  LS_API_KEY,
  SPINNER_SVG,
  CHAT_QUESTIONS_EN,
  CHAT_QUESTIONS_VI,
  WC_CHAT_QUESTIONS_EN,
  WC_CHAT_QUESTIONS_VI,
} from "./constants.js";
import { state } from "./state.js";
import { readerBody, commentsPane, openSettingsBtn } from "./dom.js";
import { escapeHtml, markdownToSafeHtml } from "./utils.js";

// Shared in-memory answer cache
const answerCache = new Map();

// ─── Shared fetch helper ──────────────────────────────────────────────────────
async function askApi(payload) {
  const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch("/api/ask", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ─── Bubble renderers ─────────────────────────────────────────────────────────
function appendUserBubble(container, text) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="flex justify-end">
      <div class="max-w-[85%] bg-hn/10 border border-hn/20 rounded-xl rounded-tr-sm px-3 py-2 text-xs text-textMain">${escapeHtml(text)}</div>
    </div>`,
  );
  container.scrollTop = container.scrollHeight;
}

function appendLoadingBubble(container, id) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div id="${id}" class="flex justify-start">
      <div class="bg-surface border border-borderSubtle rounded-xl rounded-tl-sm px-3 py-2 text-xs text-textMuted flex items-center gap-2">
        ${SPINNER_SVG}<span>Thinking…</span>
      </div>
    </div>`,
  );
  container.scrollTop = container.scrollHeight;
}

function appendAnswerBubble(
  container,
  answer,
  isCached = false,
  bgClass = "bg-surface",
) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="flex justify-start">
      <div class="max-w-[90%] ${bgClass} border border-borderSubtle rounded-xl rounded-tl-sm px-3 py-2.5 text-xs">
        <div class="prose prose-invert prose-sm max-w-none">${markdownToSafeHtml(answer)}</div>
        ${isCached ? `<p class="text-[10px] font-mono text-textMuted/40 mt-1.5 text-right">cached</p>` : ""}
      </div>
    </div>`,
  );
  container.scrollTop = container.scrollHeight;
}

function appendErrorBubble(container, msg) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="flex justify-start">
      <div class="max-w-[85%] bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-xs text-red-400">
        ${escapeHtml(msg || "Something went wrong")}
      </div>
    </div>`,
  );
  container.scrollTop = container.scrollHeight;
}

// ─── Generic ask handler ──────────────────────────────────────────────────────
async function handleAsk({
  questionText,
  cacheKey,
  payload,
  chipBtn,
  messagesEl,
  bgClass,
}) {
  appendUserBubble(messagesEl, questionText);

  if (answerCache.has(cacheKey)) {
    appendAnswerBubble(messagesEl, answerCache.get(cacheKey), true, bgClass);
    if (chipBtn) {
      chipBtn.textContent =
        "✅ " + chipBtn.textContent.replace(/^[^\s]+\s/, "");
      chipBtn.classList.add("is-answered");
    }
    return;
  }

  const loadId = `load-${Date.now()}`;
  appendLoadingBubble(messagesEl, loadId);
  if (chipBtn) {
    chipBtn.disabled = true;
    chipBtn.textContent = "⏳ " + chipBtn.textContent.replace(/^[^\s]+\s/, "");
  }

  try {
    const data = await askApi(payload);
    document.getElementById(loadId)?.remove();

    if (data.error) {
      appendErrorBubble(messagesEl, data.error);
      if (chipBtn) {
        chipBtn.disabled = false;
        chipBtn.textContent = chipBtn.textContent.replace(/^⏳\s/, "");
      }
      if (
        data.errorCode === "no_api_key" ||
        data.errorCode === "invalid_api_key"
      )
        openSettingsBtn.click();
      return;
    }

    answerCache.set(cacheKey, data.answer);
    appendAnswerBubble(messagesEl, data.answer, data.isCached, bgClass);
    if (chipBtn) {
      chipBtn.textContent =
        "✅ " + chipBtn.textContent.replace(/^[^\s]+\s/, "");
      chipBtn.classList.add("is-answered");
    }
  } catch (err) {
    document.getElementById(loadId)?.remove();
    appendErrorBubble(messagesEl, err.message);
    if (chipBtn) chipBtn.disabled = false;
  }
}

// ─── Sidebar chat ─────────────────────────────────────────────────────────────
export function loadChatContent(repo, container) {
  container.innerHTML = `
    <div class="flex items-center justify-center flex-1 py-8">
      <div class="animate-spin h-4 w-4 border-2 border-hn border-t-transparent rounded-full"></div>
      <span class="ml-2 text-sm text-textMuted">Loading chat...</span>
    </div>`;

  setTimeout(() => {
    try {
      container.innerHTML = "";
      const hasSummary = readerBody.textContent?.trim() !== "";

      if (!hasSummary) {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center">
            <p class="text-sm text-textMuted mb-1">Generate a summary first</p>
            <p class="text-xs text-textMuted/60">Chat unlocks once the repository summary is loaded.</p>
          </div>`;
        return;
      }

      const messagesEl = document.createElement("div");
      messagesEl.id = "sidebarChatMessages";
      messagesEl.className =
        "flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3";
      container.appendChild(messagesEl);

      const bottomEl = document.createElement("div");
      bottomEl.className = "shrink-0 border-t border-borderSubtle";
      const questions =
        state.currentLang === "vi" ? CHAT_QUESTIONS_VI : CHAT_QUESTIONS_EN;

      bottomEl.innerHTML = `
        <div class="px-3 pt-3 pb-2 flex flex-wrap gap-1.5">
          ${questions
            .map(
              (q) => `
            <button data-qid="${q.id}" class="sidebar-chat-chip px-2.5 py-1 rounded-full border border-borderSubtle bg-appBg text-[11px] text-textMuted hover:border-hn/50 hover:text-textMain transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
              ${escapeHtml(q.label)}
            </button>`,
            )
            .join("")}
        </div>
        <div class="flex gap-2 px-3 pb-3">
          <input id="sidebarChatInput" type="text" placeholder="Ask anything…"
            class="flex-1 bg-appBg border border-borderSubtle rounded-lg px-3 py-2 text-xs text-textMain placeholder-textMuted/50 focus:outline-none focus:border-hn transition-colors font-mono"/>
          <button id="sidebarChatSendBtn" type="button"
            class="shrink-0 px-3 py-2 bg-hn/10 border border-hn/30 hover:bg-hn/20 rounded-lg text-[11px] text-hn font-mono transition-colors">Send</button>
        </div>`;

      bottomEl.querySelectorAll(".sidebar-chat-chip").forEach((btn) => {
        const q = questions.find((x) => x.id === btn.dataset.qid);
        if (!q) return;
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const localSummary =
            localStorage.getItem(`summary_${repo.id}_${state.currentLang}`) ||
            localStorage.getItem(`summary_${repo.id}_en`) ||
            readerBody.textContent ||
            "";
          handleAsk({
            questionText: q.question,
            cacheKey: `sidebar_${repo.id}_${q.question.slice(0, 80)}_${state.currentLang}`,
            payload: {
              repoId: repo.id,
              question: q.question,
              lang: state.currentLang,
              summary: localSummary,
            },
            chipBtn: btn,
            messagesEl,
            bgClass: "bg-surface",
          });
        });
      });

      const inputEl = bottomEl.querySelector("#sidebarChatInput");
      const sendBtn = bottomEl.querySelector("#sidebarChatSendBtn");
      const doSend = () => {
        const text = inputEl.value.trim();
        if (!text) return;
        inputEl.value = "";
        const localSummary =
          localStorage.getItem(`summary_${repo.id}_${state.currentLang}`) ||
          localStorage.getItem(`summary_${repo.id}_en`) ||
          readerBody.textContent ||
          "";
        handleAsk({
          questionText: text,
          cacheKey: `sidebar_${repo.id}_${text.slice(0, 80)}_${state.currentLang}`,
          payload: {
            repoId: repo.id,
            question: text,
            lang: state.currentLang,
            summary: localSummary,
          },
          chipBtn: null,
          messagesEl,
          bgClass: "bg-surface",
        });
      };
      sendBtn.addEventListener("click", doSend);
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doSend();
        }
      });
      container.appendChild(bottomEl);
    } catch (err) {
      console.error("Failed to load chat content:", err);
      container.innerHTML = `<div class="flex flex-col items-center justify-center flex-1 py-8 text-center"><p class="text-sm text-textMuted mb-2">Failed to load chat</p></div>`;
    }
  }, 60);
}

// ─── Wordcloud chat ───────────────────────────────────────────────────────────
export function initWordcloudChat(feedKind, wordcloudContextText) {
  const chatEl = document.getElementById("wordcloudChat");
  if (!chatEl) return;
  chatEl.classList.remove("hidden");

  const messagesEl = document.getElementById("wordcloudChatMessages");
  const chipsEl = document.getElementById("wordcloudChatChips");

  const questions =
    state.currentLang === "vi" ? WC_CHAT_QUESTIONS_VI : WC_CHAT_QUESTIONS_EN;
  chipsEl.innerHTML = questions
    .map(
      (q) => `
    <button data-wcqid="${q.id}" class="wc-chat-chip px-2.5 py-1 rounded-full border border-borderSubtle bg-appBg text-[11px] text-textMuted hover:border-hn/50 hover:text-textMain transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
      ${escapeHtml(q.label)}
    </button>`,
    )
    .join("");

  chipsEl.querySelectorAll(".wc-chat-chip").forEach((btn) => {
    const q = questions.find((x) => x.id === btn.dataset.wcqid);
    if (!q) return;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      handleAsk({
        questionText: q.question,
        cacheKey: `wc_${feedKind}_${q.question.slice(0, 80)}_${state.currentLang}`,
        payload: {
          repoId: `wordcloud_${feedKind}`,
          question: q.question,
          lang: state.currentLang,
          summary: wordcloudContextText,
        },
        chipBtn: btn,
        messagesEl,
        bgClass: "bg-appBg",
      });
    });
  });

  // Replace input/send to avoid duplicate listeners
  const oldSend = document.getElementById("wordcloudChatSendBtn");
  const oldInput = document.getElementById("wordcloudChatInput");
  const newSend = oldSend.cloneNode(true);
  const newInput = oldInput.cloneNode(true);
  oldSend.replaceWith(newSend);
  oldInput.replaceWith(newInput);

  const doSend = () => {
    const text = newInput.value.trim();
    if (!text) return;
    newInput.value = "";
    handleAsk({
      questionText: text,
      cacheKey: `wc_${feedKind}_${text.slice(0, 80)}_${state.currentLang}`,
      payload: {
        repoId: `wordcloud_${feedKind}`,
        question: text,
        lang: state.currentLang,
        summary: wordcloudContextText,
      },
      chipBtn: null,
      messagesEl,
      bgClass: "bg-appBg",
    });
  };
  newSend.addEventListener("click", doSend);
  newInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}
