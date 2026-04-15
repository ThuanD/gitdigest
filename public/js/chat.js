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

// Separate in-memory cache for WordCloud chat answers
const wordcloudAnswerCache = new Map();
const WC_MAX_CACHE_SIZE = 50;

// Helper to maintain cache size limit with proper LRU
function maintainCacheSize() {
  if (answerCache.size > MAX_CACHE_SIZE) {
    const firstKey = answerCache.keys().next().value;
    if (firstKey !== undefined) {
      answerCache.delete(firstKey);
    }
  }
}

// Helper to maintain WordCloud cache size limit with proper LRU
function maintainWordcloudCacheSize() {
  if (wordcloudAnswerCache.size > WC_MAX_CACHE_SIZE) {
    // Find the least recently used entry (oldest access time)
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, value] of wordcloudAnswerCache.entries()) {
      if (value.accessTime && value.accessTime < oldestTime) {
        oldestTime = value.accessTime;
        oldestKey = key;
      }
    }
    
    // If no access time found, fall back to first key
    if (!oldestKey) {
      oldestKey = wordcloudAnswerCache.keys().next().value;
    }
    
    if (oldestKey !== undefined) {
      wordcloudAnswerCache.delete(oldestKey);
    }
  }
}

// Synchronized localStorage operations to prevent race conditions
const localStorageMutex = new Map();

async function withLocalStorageLock(key, operation) {
  const maxWaitTime = 5000; // 5 seconds max wait
  const startTime = Date.now();
  
  while (localStorageMutex.has(key) && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  if (localStorageMutex.has(key)) {
    throw new Error(`localStorage operation timed out for key: ${key}`);
  }
  
  try {
    localStorageMutex.set(key, true);
    return await operation();
  } finally {
    localStorageMutex.delete(key);
  }
}

// Safe encoding function that handles Unicode characters with proper hashing
function safeEncode(str) {
  try {
    return btoa(encodeURIComponent(str));
  } catch (error) {
    // Use simple hash function to prevent collisions
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Validate feedKind parameter
function validateFeedKind(feedKind) {
  const validKinds = ['daily', 'weekly', 'monthly'];
  return validKinds.includes(feedKind) ? feedKind : 'daily';
}

// Generate period-specific cache key for WordCloud
function generateWordcloudCacheKey(feedKind, question, lang) {
  const validatedFeedKind = validateFeedKind(feedKind);
  return `wc_${validatedFeedKind}_${safeEncode(question)}_${lang}`;
}

// Validation helper for chat input
function validateChatInput(text) {
  const trimmedText = text.trim();

  // Length validation
  if (trimmedText.length < 10) {
    return {
      isValid: false,
      error: "Question too short (min 10 characters)",
    };
  }

  if (trimmedText.length > 300) {
    return {
      isValid: false,
      error: "Question too long (max 300 characters)",
    };
  }

  // Content filtering - block abuse patterns
  const blockedPatterns = [
    /ignore.*summary/i,
    /forget.*previous/i,
    /act.*different/i,
    /system.*prompt/i,
    /<script|javascript:|data:/i,
    /hack|exploit|bypass/i,
  ];

  const isBlocked = blockedPatterns.some((pattern) =>
    pattern.test(trimmedText),
  );
  if (isBlocked) {
    return {
      isValid: false,
      error: "Question contains blocked content",
    };
  }

  return {
    isValid: true,
    error: null,
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
        ["user", "assistant", "error"].includes(msg.type),
    );
  } catch (error) {
    console.warn("Error loading chat history:", error);
    return [];
  }
}

async function saveChatHistory(repoId, messages) {
  const storageKey = `${LS_CHAT_HISTORY}_${repoId}`;
  
  return withLocalStorageLock(storageKey, async () => {
    try {
      if (!Array.isArray(messages)) return;

      const validMessages = messages.filter(
        (msg) =>
          msg &&
          typeof msg === "object" &&
          msg.type &&
          typeof msg.text === "string" &&
          ["user", "assistant", "error"].includes(msg.type),
      );

      const serializedData = JSON.stringify(validMessages);
      
      // Check localStorage quota before setting
      try {
        localStorage.setItem(storageKey, serializedData);
      } catch (quotaError) {
        if (quotaError.name === 'QuotaExceededError' || 
            quotaError.message.includes('quota') ||
            quotaError.message.includes('storage')) {
          
          // Try to free up space by removing oldest entries
          console.warn("LocalStorage quota exceeded, attempting cleanup...");
          
          // Remove oldest half of messages
          const halfLength = Math.floor(validMessages.length / 2);
          const trimmedMessages = validMessages.slice(halfLength);
          
          try {
            localStorage.setItem(storageKey, JSON.stringify(trimmedMessages));
            console.log("Successfully freed up space by removing old messages");
          } catch (retryError) {
            // If still fails, clear all history for this repo
            console.warn("Still unable to save, clearing all history for this repo");
            localStorage.removeItem(storageKey);
            throw new Error("Storage quota exceeded. History cleared.");
          }
        } else {
          throw quotaError;
        }
      }
    } catch (error) {
      console.warn("Error saving chat history:", error);
      throw error;
    }
  });
}

/**
 * Append a message to persisted chat history.
 * Only call this when a NEW message is produced (not when replaying history).
 */
async function persistChatMessage(repoId, message) {
  if (
    !repoId ||
    !message ||
    typeof message !== "object" ||
    !message.type ||
    typeof message.text !== "string"
  ) {
    return;
  }

  const storageKey = `${LS_CHAT_HISTORY}_${repoId}`;
  
  return withLocalStorageLock(storageKey, async () => {
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

    localStorage.setItem(storageKey, JSON.stringify(history));
  });
}

/**
 * Get WordCloud-specific chat history with period isolation
 */
function getWordcloudChatHistory(feedKind) {
  return getChatHistory(`wordcloud_${feedKind}`);
}

/**
 * Persist WordCloud-specific chat message with period isolation
 */
async function persistWordcloudChatMessage(feedKind, message) {
  return persistChatMessage(`wordcloud_${feedKind}`, message);
}

/**
 * Clear WordCloud cache for a specific period
 */
function clearWordcloudCache(feedKind) {
  try {
    const validatedFeedKind = validateFeedKind(feedKind);
    const historyKey = `wordcloud_${validatedFeedKind}`;
    
    // Clear localStorage with error handling
    try {
      localStorage.removeItem(`${LS_CHAT_HISTORY}_${historyKey}`);
    } catch (error) {
      console.warn("Failed to clear localStorage:", error);
    }
    
    // Clear in-memory cache entries for this period
    const keysToDelete = [];
    for (const key of wordcloudAnswerCache.keys()) {
      if (key.startsWith(`wc_${validatedFeedKind}_`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => wordcloudAnswerCache.delete(key));
    
    console.log(`Cleared cache for period: ${validatedFeedKind}`);
  } catch (error) {
    console.error("Failed to clear WordCloud cache:", error);
  }
}

/**
 * Get WordCloud cache statistics
 */
function getWordcloudCacheStats() {
  const periodStats = {};
  const periods = ['daily', 'weekly', 'monthly'];
  
  periods.forEach(period => {
    const history = getWordcloudChatHistory(period);
    const memoryEntries = Array.from(wordcloudAnswerCache.keys())
      .filter(key => key.startsWith(`wc_${period}_`)).length;
    
    periodStats[period] = {
      historyMessages: history.length,
      memoryEntries: memoryEntries,
      totalCacheSize: history.length + memoryEntries
    };
  });
  
  return {
    periods: periodStats,
    totalMemoryEntries: wordcloudAnswerCache.size,
    maxMemoryEntries: WC_MAX_CACHE_SIZE,
    memoryUtilization: `${((wordcloudAnswerCache.size / WC_MAX_CACHE_SIZE) * 100).toFixed(1)}%`
  };
}

// ─── Bubble renderers (pure render — no side-effects on storage) ──────────────

function renderUserBubble(container, text) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="flex justify-end">
      <div class="max-w-[85%] bg-hn/10 border border-hn/20 rounded-xl rounded-tr-sm px-3 py-2 text-xs text-textMain">${escapeHtml(text)}</div>
    </div>`,
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
    </div>`,
  );
  container.scrollTop = container.scrollHeight;
}

function renderAnswerBubble(
  container,
  answer,
  isCached = false,
  bgClass = "bg-surface",
) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div class="flex justify-start">
      <div class="max-w-[90%] ${bgClass} border border-borderSubtle rounded-xl rounded-tl-sm px-3 py-2.5 text-sm">
        <div class="text-xs prose prose-invert prose-sm max-w-none">${markdownToSafeHtml(answer)}</div>
        ${isCached ? `<p class="text-[10px] font-mono text-textMuted/40 mt-1.5 text-right">cached</p>` : ""}
      </div>
    </div>`,
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
    </div>`,
  );
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function askApi(payload) {
  try {
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

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return data;
  } catch (error) {
    console.error("API request failed:", error);
    
    // Return a consistent error structure
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return { error: "Network error. Please check your connection." };
    } else if (error.message.includes('HTTP')) {
      return { error: error.message };
    } else {
      return { error: "Request failed. Please try again." };
    }
  }
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
    try {
      await persistChatMessage(repoId, {
        type: "user",
        text: questionText,
        // Don't persist questionId yet - wait for successful response
      });
    } catch (error) {
      console.warn("Failed to persist user message:", error);
    }
  }

  // 2. Check in-memory answer cache (use appropriate cache based on repoId)
  const isWordcloudChat = repoId && repoId.startsWith('wordcloud_');
  const cache = isWordcloudChat ? wordcloudAnswerCache : answerCache;
  
  if (cache.has(cacheKey)) {
    const cachedEntry = cache.get(cacheKey);
    const cachedAnswer = cachedEntry.answer || cachedEntry; // Handle both formats
    const isCached = cachedEntry.isCached !== undefined ? cachedEntry.isCached : true;
    
    // Update access time for LRU
    if (isWordcloudChat) {
      cache.set(cacheKey, { answer: cachedAnswer, accessTime: Date.now(), isCached });
    } else {
      cache.set(cacheKey, cachedAnswer); // Regular cache doesn't track time yet
    }
    
    renderAnswerBubble(messagesEl, cachedAnswer, isCached, bgClass);
    if (repoId) {
      try {
        const persistFn = isWordcloudChat 
          ? (feedKind, msg) => persistWordcloudChatMessage(feedKind, msg)
          : persistChatMessage;
        
        const persistKey = isWordcloudChat ? repoId.replace('wordcloud_', '') : repoId;
        
        await persistFn(persistKey, {
          type: "assistant",
          text: cachedAnswer,
          isCached: true,
        });
        
        // Update user message with questionId for chip questions (successful response)
        if (questionId) {
          const storageKey = isWordcloudChat ? `wordcloud_${persistKey}` : repoId;
          await withLocalStorageLock(storageKey, async () => {
            const history = isWordcloudChat 
              ? getWordcloudChatHistory(persistKey)
              : getChatHistory(repoId);
            const updatedHistory = [...history]; // Create copy to avoid race condition
            const lastMessage = updatedHistory[updatedHistory.length - 1];
            if (
              lastMessage &&
              lastMessage.type === "user" &&
              lastMessage.text === questionText
            ) {
              lastMessage.questionId = questionId;
              localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
            }
          });
        }
      } catch (error) {
        console.warn("Failed to persist cache hit:", error);
      }
    }
    if (chipBtn) {
      disableChip(chipBtn);
    }
    // Maintain appropriate cache size limit
    if (isWordcloudChat) {
      maintainWordcloudCacheSize();
    } else {
      maintainCacheSize();
    }
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
        try {
          const persistFn = isWordcloudChat 
            ? (feedKind, msg) => persistWordcloudChatMessage(feedKind, msg)
            : persistChatMessage;
          
          const persistKey = isWordcloudChat ? repoId.replace('wordcloud_', '') : repoId;
          
          await persistFn(persistKey, { type: "error", text: data.error });
        } catch (error) {
          console.warn("Failed to persist error message:", error);
        }
      }
      // Re-enable chip so user can retry
      if (chipBtn) {
        chipBtn.disabled = false;
        chipBtn.textContent = stripPrefix(chipBtn.textContent).replace(
          /^⏳\s*/,
          "",
        );
      }
      return;
    }

    // 4b. Success
    const targetCache = isWordcloudChat ? wordcloudAnswerCache : answerCache;
    if (isWordcloudChat) {
      targetCache.set(cacheKey, { 
        answer: data.answer, 
        accessTime: Date.now(), 
        isCached: !!data.isCached 
      });
    } else {
      targetCache.set(cacheKey, data.answer);
    }
    
    // Maintain appropriate cache size limit
    if (isWordcloudChat) {
      maintainWordcloudCacheSize();
    } else {
      maintainCacheSize();
    }
    
    renderAnswerBubble(messagesEl, data.answer, data.isCached, bgClass);
    if (repoId) {
      try {
        const persistFn = isWordcloudChat 
          ? (feedKind, msg) => persistWordcloudChatMessage(feedKind, msg)
          : persistChatMessage;
        
        const persistKey = isWordcloudChat ? repoId.replace('wordcloud_', '') : repoId;
        
        await persistFn(persistKey, {
          type: "assistant",
          text: data.answer,
          isCached: !!data.isCached,
        });
        
        // Update user message with questionId for chip questions (successful response)
        if (questionId) {
          const storageKey = isWordcloudChat ? `wordcloud_${persistKey}` : repoId;
          await withLocalStorageLock(storageKey, async () => {
            const history = isWordcloudChat 
              ? getWordcloudChatHistory(persistKey)
              : getChatHistory(repoId);
            const updatedHistory = [...history]; // Create copy to avoid race condition
            const lastMessage = updatedHistory[updatedHistory.length - 1];
            if (
              lastMessage &&
              lastMessage.type === "user" &&
              lastMessage.text === questionText
            ) {
              lastMessage.questionId = questionId;
              localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
            }
          });
        }
      } catch (error) {
        console.warn("Failed to persist success response:", error);
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
      try {
        const persistFn = isWordcloudChat 
          ? (feedKind, msg) => persistWordcloudChatMessage(feedKind, msg)
          : persistChatMessage;
        
        const persistKey = isWordcloudChat ? repoId.replace('wordcloud_', '') : repoId;
        
        await persistFn(persistKey, { type: "error", text: errMsg });
      } catch (error) {
        console.warn("Failed to persist error message:", error);
      }
    }
    // Re-enable chip so user can retry
    if (chipBtn) {
      chipBtn.disabled = false;
      chipBtn.textContent = stripPrefix(chipBtn.textContent).replace(
        /^⏳\s*/,
        "",
      );
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
      messagesEl.className =
        "flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3";
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
                renderAnswerBubble(
                  messagesEl,
                  message.text,
                  !!message.isCached,
                  "bg-surface",
                );
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
                </button>`,
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
              type: "chip",
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
            type: "manual",
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

export function renderWordcloudChatError(title, hint) {
  const messagesEl = document.getElementById("wordcloudChatMessages");
  const chipsEl = document.getElementById("wordcloudChatChips");
  const inputEl = document.getElementById("wordcloudChatInput");
  const sendBtn = document.getElementById("wordcloudChatSendBtn");
  if (!messagesEl) return;

  cleanupWordcloudChatEvents();

  if (chipsEl) chipsEl.innerHTML = "";
  messagesEl.innerHTML = `
    <div class="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center">
      <p class="text-sm text-textMuted mb-1">${escapeHtml(title)}</p>
      <p class="text-xs text-textMuted/60">${escapeHtml(hint)}</p>
    </div>`;

  if (inputEl) {
    inputEl.disabled = true;
    inputEl.placeholder = "Chat unavailable";
  }
  if (sendBtn) sendBtn.disabled = true;
}

export function initWordcloudChat(feedKind, wordcloudContextText) {
  const messagesEl = document.getElementById("wordcloudChatMessages");
  const chipsEl = document.getElementById("wordcloudChatChips");
  const sendBtn = document.getElementById("wordcloudChatSendBtn");
  const inputEl = document.getElementById("wordcloudChatInput");

  if (!messagesEl || !chipsEl || !sendBtn || !inputEl) return;

  // Clean up existing event listeners to prevent memory leaks
  cleanupWordcloudChatEvents();

  // Clear previous chips but load persisted messages for current period
  chipsEl.innerHTML = "";
  messagesEl.innerHTML = "";

  // Re-enable input (may have been disabled by an earlier error state)
  inputEl.disabled = false;
  inputEl.placeholder = inputEl.dataset.originalPlaceholder || "Ask anything about trends…";
  sendBtn.disabled = false;

  const questions =
    state.currentLang === "vi" ? WC_CHAT_QUESTIONS_VI : WC_CHAT_QUESTIONS_EN;

  // Render chip buttons FIRST
  chipsEl.innerHTML = questions
    .map(
      (q) =>
        `<button data-wcqid="${q.id}" class="wc-chat-chip px-2.5 py-1 rounded-full border border-borderSubtle bg-appBg text-[11px] text-textMuted hover:border-hn/50 hover:text-textMain transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
          ${escapeHtml(q.label)}
        </button>`,
    )
    .join("");

  // Load and render persisted chat history for this WordCloud period
  const wcHistory = getWordcloudChatHistory(feedKind);
  if (wcHistory.length > 0) {
    // Build the set of answered question IDs from history
    const answeredQuestionIds = new Set();
    wcHistory.forEach((msg) => {
      if (msg.type === "user" && msg.questionId) {
        answeredQuestionIds.add(msg.questionId);
      }
    });

    // Render messages first
    wcHistory.forEach((msg) => {
      try {
        switch (msg.type) {
          case "user":
            if (msg.text) renderUserBubble(messagesEl, msg.text);
            break;
          case "assistant":
            if (msg.text) {
              renderAnswerBubble(messagesEl, msg.text, !!msg.isCached, "bg-appBg");
            }
            break;
          case "error":
            if (msg.text) renderErrorBubble(messagesEl, msg.text);
            break;
        }
      } catch (error) {
        console.warn("Error displaying WordCloud chat message:", error, msg);
      }
    });
    
    // THEN update chip states based on answered questions
    chipsEl.querySelectorAll(".wc-chat-chip").forEach((btn) => {
      const qId = btn.dataset.wcqid;
      if (qId && answeredQuestionIds.has(qId)) {
        disableChip(btn);
      }
    });
  }

  chipsEl.querySelectorAll(".wc-chat-chip").forEach((btn) => {
    const q = questions.find((x) => x.id === btn.dataset.wcqid);
    if (!q) return;

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      handleAsk({
        questionText: q.question,
        cacheKey: generateWordcloudCacheKey(feedKind, q.question, state.currentLang),
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
        repoId: `wordcloud_${feedKind}`,
        questionId: q.id,
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
      cacheKey: generateWordcloudCacheKey(feedKind, text, state.currentLang),
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
      repoId: `wordcloud_${feedKind}`,
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

// Export WordCloud cache utilities for external use
export {
  clearWordcloudCache,
  getWordcloudCacheStats,
  getWordcloudChatHistory,
  persistWordcloudChatMessage,
  generateWordcloudCacheKey,
  wordcloudAnswerCache,
};

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
  chips.forEach((chip) => {
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
