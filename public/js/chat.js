import {
  LS_API_KEY,
  LS_AI_PROVIDER,
  LS_AI_MODEL,
  LS_CHAT_HISTORY,
  SPINNER_SVG,
  CHAT_QUESTIONS_EN,
  CHAT_QUESTIONS_VI,
  WC_CHAT_QUESTIONS_EN,
  WC_CHAT_QUESTIONS_VI,
} from "./constants.js";
import { state } from "./state.js";
import { readerBody } from "./dom.js";
import { escapeHtml, markdownToSafeHtml } from "./utils.js";

// Shared in-memory answer cache with LRU size limit
const answerCache = new Map();
const MAX_CACHE_SIZE = 100;

// Helper to maintain cache size limit
function maintainCacheSize() {
  if (answerCache.size > MAX_CACHE_SIZE) {
    const firstKey = answerCache.keys().next().value;
    if (firstKey !== undefined) {
      answerCache.delete(firstKey);
    }
  }
}

// Safe encoding function that handles Unicode characters
function safeEncode(str) {
  try {
    return btoa(encodeURIComponent(str));
  } catch (error) {
    // Fallback to alphanumeric hash for problematic strings
    return str.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  }
}

// Validation helper for chat input
function validateChatInput(text) {
  const trimmedText = text.trim();
  
  // Length validation
  if (trimmedText.length < 10) {
    return {
      isValid: false,
      error: "Question too short (min 10 characters)"
    };
  }
  
  if (trimmedText.length > 300) {
    return {
      isValid: false,
      error: "Question too long (max 300 characters)"
    };
  }
  
  // Content filtering - block abuse patterns
  const blockedPatterns = [
    /ignore.*summary/i,
    /forget.*previous/i,
    /act.*different/i,
    /system.*prompt/i,
    /<script|javascript:|data:/i,
    /hack|exploit|bypass/i
  ];
  
  const isBlocked = blockedPatterns.some(pattern => pattern.test(trimmedText));
  if (isBlocked) {
    return {
      isValid: false,
      error: "Question contains blocked content"
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

// ─── Chat history management ──────────────────────────────────────────────────

function getChatHistory(repoId) {
  try {
    const history = localStorage.getItem(`${LS_CHAT_HISTORY}_${repoId}`);
    if (!history) return [];

    const parsed = JSON.parse(history);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (msg) =>
        msg &&
        typeof msg === "object" &&
        msg.type &&
        typeof msg.text === "string" &&
        ["user", "assistant", "error"].includes(msg.type)
    );
  } catch (error) {
    console.warn("Error loading chat history:", error);
    return [];
  }
}

function saveChatHistory(repoId, messages) {
  try {
    if (!Array.isArray(messages)) return;

    const validMessages = messages.filter(
      (msg) =>
        msg &&
        typeof msg === "object" &&
        msg.type &&
        typeof msg.text === "string" &&
        ["user", "assistant", "error"].includes(msg.type)
    );

    localStorage.setItem(
      `${LS_CHAT_HISTORY}_${repoId}`,
      JSON.stringify(validMessages)
    );
  } catch (error) {
    console.warn("Error saving chat history:", error);
  }
}

/**
 * Append a message to persisted chat history.
 * Only call this when a NEW message is produced (not when replaying history).
 */
function persistChatMessage(repoId, message) {
  if (
    !repoId ||
    !message ||
    typeof message !== "object" ||
    !message.type ||
    typeof message.text !== "string"
  ) {
    return;
  }

  const history = getChatHistory(repoId);
  const newMessage = {
    type: message.type,
    text: message.text,
    timestamp: Date.now(),
  };

  if (message.type === "assistant" && typeof message.isCached === "boolean") {
    newMessage.isCached = message.isCached;
  }

  // For chip questions, persist the questionId so we can restore chip state
  if (message.type === "user" && message.questionId) {
    newMessage.questionId = message.questionId;
  }

  history.push(newMessage);

  // Keep last 50 messages per repo
  if (history.length > 50) {
    history.splice(0, history.length - 50);
  }

  saveChatHistory(repoId, history);
}

// ─── Bubble renderers (pure render — no side-effects on storage) ──────────────

function renderUserBubble(container, text) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="flex justify-end">
      <div class="max-w-[85%] bg-hn/10 border border-hn/20 rounded-xl rounded-tr-sm px-3 py-2 text-xs text-textMain">${escapeHtml(text)}</div>
    </div>`
  );
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderLoadingBubble(container, id) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div id="${id}" class="flex justify-start">
      <div class="bg-surface border border-borderSubtle rounded-xl rounded-tl-sm px-3 py-2 text-xs text-textMuted flex items-center gap-2">
        ${SPINNER_SVG}<span>Thinking…</span>
      </div>
    </div>`
  );
  container.scrollTop = container.scrollHeight;
}

function renderAnswerBubble(container, answer, isCached = false, bgClass = "bg-surface") {
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="flex justify-start">
      <div class="max-w-[90%] ${bgClass} border border-borderSubtle rounded-xl rounded-tl-sm px-3 py-2.5 text-sm">
        <div class="text-xs prose prose-invert prose-sm max-w-none">${markdownToSafeHtml(answer)}</div>
        ${isCached ? `<p class="text-[10px] font-mono text-textMuted/40 mt-1.5 text-right">cached</p>` : ""}
      </div>
    </div>`
  );
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderErrorBubble(container, msg) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="flex justify-start">
      <div class="max-w-[85%] bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-xs text-red-400">
        ${escapeHtml(msg || "Something went wrong")}
      </div>
    </div>`
  );
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function askApi(payload) {
  const apiKey = (localStorage.getItem(LS_API_KEY) || "").trim();
  const provider = localStorage.getItem(LS_AI_PROVIDER) || "openai";
  const model = (localStorage.getItem(LS_AI_MODEL) || "").trim();

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const enhancedPayload = {
    ...payload,
    ...(provider && { provider }),
    ...(model && { model }),
    ...(payload.type && { type: payload.type }),
  };

  const res = await fetch("/api/ask", {
    method: "POST",
    headers,
    body: JSON.stringify(enhancedPayload),
  });
  return res.json();
}

// ─── Generic ask handler ──────────────────────────────────────────────────────
/**
 * Handles a single Q&A turn:
 *  - Renders user bubble & persists it
 *  - Shows loading indicator
 *  - Calls API (or hits in-memory cache)
 *  - On success: renders answer bubble, persists it, disables chip
 *  - On failure: renders error bubble, persists it, re-enables chip
 */
export async function handleAsk({
  questionText,
  cacheKey,
  payload,
  chipBtn,
  messagesEl,
  bgClass = "bg-surface",
  repoId,
  questionId, // present only for chip questions
}) {
  // 1. Render user message (persist only on successful response)
  renderUserBubble(messagesEl, questionText);
  if (repoId) {
    persistChatMessage(repoId, {
      type: "user",
      text: questionText,
      // Don't persist questionId yet - wait for successful response
    });
  }

  // 2. Check in-memory answer cache
  if (answerCache.has(cacheKey)) {
    const cachedAnswer = answerCache.get(cacheKey);
    renderAnswerBubble(messagesEl, cachedAnswer, true, bgClass);
    if (repoId) {
      persistChatMessage(repoId, { type: "assistant", text: cachedAnswer, isCached: true });
      // Update user message with questionId for chip questions (successful response)
      if (questionId) {
        const history = getChatHistory(repoId);
        const updatedHistory = [...history]; // Create copy to avoid race condition
        const lastMessage = updatedHistory[updatedHistory.length - 1];
        if (lastMessage && lastMessage.type === "user" && lastMessage.text === questionText) {
          lastMessage.questionId = questionId;
          saveChatHistory(repoId, updatedHistory);
        }
      }
    }
    if (chipBtn) {
      disableChip(chipBtn);
    }
    maintainCacheSize(); // Maintain cache size limit for cache hits
    return;
  }

  // 3. Show loading + disable chip optimistically
  const loadId = `load-${Date.now()}`;
  renderLoadingBubble(messagesEl, loadId);
  if (chipBtn) {
    chipBtn.disabled = true;
    chipBtn.textContent = "⏳ " + stripPrefix(chipBtn.textContent);
  }

  try {
    const data = await askApi(payload);
    document.getElementById(loadId)?.remove();

    if (data.error) {
      // 4a. API returned an error
      renderErrorBubble(messagesEl, data.error);
      if (repoId) {
        persistChatMessage(repoId, { type: "error", text: data.error });
      }
      // Re-enable chip so user can retry
      if (chipBtn) {
        chipBtn.disabled = false;
        chipBtn.textContent = stripPrefix(chipBtn.textContent).replace(/^⏳\s*/, "");
      }
      return;
    }

    // 4b. Success
    answerCache.set(cacheKey, data.answer);
    maintainCacheSize(); // Maintain cache size limit
    renderAnswerBubble(messagesEl, data.answer, data.isCached, bgClass);
    if (repoId) {
      persistChatMessage(repoId, { type: "assistant", text: data.answer, isCached: !!data.isCached });
      // Update user message with questionId for chip questions (successful response)
      if (questionId) {
        const history = getChatHistory(repoId);
        const updatedHistory = [...history]; // Create copy to avoid race condition
        const lastMessage = updatedHistory[updatedHistory.length - 1];
        if (lastMessage && lastMessage.type === "user" && lastMessage.text === questionText) {
          lastMessage.questionId = questionId;
          saveChatHistory(repoId, updatedHistory);
        }
      }
    }
    if (chipBtn) {
      disableChip(chipBtn);
    }
  } catch (err) {
    document.getElementById(loadId)?.remove();
    const errMsg = err.message || "Network error";
    renderErrorBubble(messagesEl, errMsg);
    if (repoId) {
      persistChatMessage(repoId, { type: "error", text: errMsg });
    }
    // Re-enable chip so user can retry
    if (chipBtn) {
      chipBtn.disabled = false;
      chipBtn.textContent = stripPrefix(chipBtn.textContent).replace(/^⏳\s*/, "");
    }
  }
}

// ─── Chip helpers ─────────────────────────────────────────────────────────────

function stripPrefix(text) {
  // Remove leading emoji/symbol + space (e.g. "⏳ ", "✅ ")
  return text.replace(/^[^\w\s]*\s+/, "").trim();
}

function disableChip(btn) {
  btn.disabled = true;
  btn.classList.add("is-answered");
  const clean = stripPrefix(btn.textContent);
  btn.textContent = "✅ " + clean;
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

      // Resolve question list early so it's available everywhere below
      const questions =
        state.currentLang === "vi" ? CHAT_QUESTIONS_VI : CHAT_QUESTIONS_EN;

      // Build the set of questionIds that have already been answered
      // by scanning persisted history BEFORE rendering anything
      const chatHistory = getChatHistory(repo.id);
      const answeredQuestionIds = new Set();
      chatHistory.forEach((msg) => {
        if (msg.type === "user" && msg.questionId) {
          answeredQuestionIds.add(msg.questionId);
        }
      });

      // ── Messages area ──
      const messagesEl = document.createElement("div");
      messagesEl.id = "sidebarChatMessages";
      messagesEl.className = "flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3";
      container.appendChild(messagesEl);

      // Replay history (render only — no persistence)
      chatHistory.forEach((message) => {
        try {
          switch (message.type) {
            case "user":
              if (message.text) renderUserBubble(messagesEl, message.text);
              break;
            case "assistant":
              if (message.text)
                renderAnswerBubble(messagesEl, message.text, !!message.isCached, "bg-surface");
              break;
            case "error":
              if (message.text) renderErrorBubble(messagesEl, message.text);
              break;
          }
        } catch (error) {
          console.warn("Error displaying chat message:", error, message);
        }
      });

      // ── Bottom bar ──
      const bottomEl = document.createElement("div");
      bottomEl.className = "shrink-0 border-t border-borderSubtle";

      bottomEl.innerHTML = `
        <div class="px-3 pt-3 pb-2 flex flex-wrap gap-1.5">
          ${questions
            .map(
              (q) =>
                `<button data-qid="${q.id}" class="sidebar-chat-chip px-2.5 py-1 rounded-full border border-borderSubtle bg-appBg text-[11px] text-textMuted hover:border-hn/50 hover:text-textMain transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
                  ${escapeHtml(q.label)}
                </button>`
            )
            .join("")}
        </div>
        <div class="flex gap-2 px-3 pb-3">
          <input id="sidebarChatInput" type="text" placeholder="Ask anything…" maxlength="300"
            class="flex-1 bg-appBg border border-borderSubtle rounded-lg px-3 py-2 text-xs text-textMain placeholder-textMuted/50 focus:outline-none focus:border-hn transition-colors font-mono"/>
          <button id="sidebarChatSendBtn" type="button"
            class="shrink-0 px-3 py-2 bg-hn/10 border border-hn/30 hover:bg-hn/20 rounded-lg text-[11px] text-hn font-mono transition-colors">Send</button>
        </div>`;

      // Restore chip states from history, then wire up click handlers
      bottomEl.querySelectorAll(".sidebar-chat-chip").forEach((btn) => {
        const q = questions.find((x) => x.id === btn.dataset.qid);
        if (!q) return;

        if (answeredQuestionIds.has(q.id)) {
          // Already answered in a previous session — show as disabled
          btn.disabled = true;
          btn.classList.add("is-answered");
          btn.textContent = "✅ " + q.label;
        }

        btn.addEventListener("click", () => {
          if (btn.disabled) return;

          const localSummary =
            localStorage.getItem(`summary_${repo.id}_${state.currentLang}`) ||
            localStorage.getItem(`summary_${repo.id}_en`) ||
            readerBody.textContent ||
            "";

          handleAsk({
            questionText: q.question,
            cacheKey: `sidebar_${repo.id}_${safeEncode(q.question)}_${state.currentLang}`,
            payload: {
              repoId: repo.id,
              question: q.question,
              lang: state.currentLang,
              summary: localSummary,
              type: 'chip',
            },
            chipBtn: btn,
            messagesEl,
            bgClass: "bg-surface",
            repoId: repo.id,
            questionId: q.id,
          });
        });
      });

      const inputEl = bottomEl.querySelector("#sidebarChatInput");
      const sendBtn = bottomEl.querySelector("#sidebarChatSendBtn");

      const doSend = () => {
        const text = inputEl.value.trim();
        if (!text) return;
        
        // Validate input before sending
        const validation = validateChatInput(text);
        if (!validation.isValid) {
          renderErrorBubble(messagesEl, validation.error);
          return;
        }
        
        inputEl.value = "";

        const localSummary =
          localStorage.getItem(`summary_${repo.id}_${state.currentLang}`) ||
          localStorage.getItem(`summary_${repo.id}_en`) ||
          readerBody.textContent ||
          "";

        handleAsk({
          questionText: text,
          cacheKey: `sidebar_${repo.id}_${safeEncode(text)}_${state.currentLang}`,
          payload: {
            repoId: repo.id,
            question: text,
            lang: state.currentLang,
            summary: localSummary,
            type: 'manual',
          },
          chipBtn: null, // manual input — no chip to manage
          messagesEl,
          bgClass: "bg-surface",
          repoId: repo.id,
          // no questionId — not a chip question
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
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center flex-1 py-8 text-center">
          <p class="text-sm text-textMuted mb-2">Failed to load chat</p>
        </div>`;
    }
  }, 60);
}

// ─── Wordcloud chat ───────────────────────────────────────────────────────────
// Called each time wordcloud data loads (period may change).
// Re-renders chip list and re-wires input handlers; messages persist in DOM
// until the user navigates away or clears.

export function initWordcloudChat(feedKind, wordcloudContextText) {
  const messagesEl = document.getElementById("wordcloudChatMessages");
  const chipsEl = document.getElementById("wordcloudChatChips");
  const sendBtn = document.getElementById("wordcloudChatSendBtn");
  const inputEl = document.getElementById("wordcloudChatInput");

  if (!messagesEl || !chipsEl || !sendBtn || !inputEl) return;

  // Clean up existing event listeners to prevent memory leaks
  cleanupWordcloudChatEvents();

  // Clear previous chips and messages when period changes
  chipsEl.innerHTML = "";
  messagesEl.innerHTML = "";

  const questions =
    state.currentLang === "vi" ? WC_CHAT_QUESTIONS_VI : WC_CHAT_QUESTIONS_EN;

  // Render chip buttons
  chipsEl.innerHTML = questions
    .map(
      (q) =>
        `<button data-wcqid="${q.id}" class="wc-chat-chip px-2.5 py-1 rounded-full border border-borderSubtle bg-appBg text-[11px] text-textMuted hover:border-hn/50 hover:text-textMain transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
          ${escapeHtml(q.label)}
        </button>`
    )
    .join("");

  chipsEl.querySelectorAll(".wc-chat-chip").forEach((btn) => {
    const q = questions.find((x) => x.id === btn.dataset.wcqid);
    if (!q) return;

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      handleAsk({
        questionText: q.question,
        cacheKey: `wc_${feedKind}_${safeEncode(q.question)}_${state.currentLang}`,
        payload: {
          repoId: `wordcloud_${feedKind}`,
          question: q.question,
          lang: state.currentLang,
          summary: wordcloudContextText,
          type: "chip",
        },
        chipBtn: btn,
        messagesEl,
        bgClass: "bg-appBg",
      });
    });
  });

  // Re-wire send button and input (clone to drop any previous listeners)
  const newSend = sendBtn.cloneNode(true);
  const newInput = inputEl.cloneNode(true);
  sendBtn.replaceWith(newSend);
  inputEl.replaceWith(newInput);

  const doSend = () => {
    const text = newInput.value.trim();
    if (!text) return;
    const validation = validateChatInput(text);
    if (!validation.isValid) {
      renderErrorBubble(messagesEl, validation.error);
      return;
    }
    newInput.value = "";
    handleAsk({
      questionText: text,
      cacheKey: `wc_${feedKind}_${safeEncode(text)}_${state.currentLang}`,
      payload: {
        repoId: `wordcloud_${feedKind}`,
        question: text,
        lang: state.currentLang,
        summary: wordcloudContextText,
        type: "manual",
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

// Store event cleanup functions
let wordcloudChatCleanup = null;

// Cleanup function to remove event listeners and prevent memory leaks
function cleanupWordcloudChatEvents() {
  if (wordcloudChatCleanup) {
    wordcloudChatCleanup();
    wordcloudChatCleanup = null;
  }
  
  // Remove all event listeners from chip buttons
  const chips = document.querySelectorAll(".wc-chat-chip");
  chips.forEach(chip => {
    const newChip = chip.cloneNode(true);
    chip.parentNode.replaceChild(newChip, chip);
  });
  
  // Remove event listeners from send button and input
  const sendBtn = document.getElementById("wordcloudChatSendBtn");
  const inputEl = document.getElementById("wordcloudChatInput");
  
  if (sendBtn) {
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
  }
  
  if (inputEl) {
    const newInputEl = inputEl.cloneNode(true);
    inputEl.parentNode.replaceChild(newInputEl, inputEl);
  }
}
