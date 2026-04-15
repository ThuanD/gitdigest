import { LS_FEED_KIND, LS_PREF_LANG } from "./constants.js";

/**
 * Centralised mutable state — import `state` and mutate its properties directly.
 * Modules that need to react to changes should do so via the exported setters
 * (which can be extended with side-effects without touching every callsite).
 */
export const state = {
  /** ISO lang code currently active */
  currentLang: localStorage.getItem(LS_PREF_LANG) || "en",

  /** ID of the card/repo currently open in the reader */
  activeCardId: /** @type {string|null} */ (null),

  /** Full repo object currently open in the reader */
  currentActiveRepo: /** @type {object|null} */ (null),

  /** Pagination cursor for the feed list */
  currentPage: 1,

  /** Whether "hide read" filter is active */
  hideReadActive: false,

  /** Whether "favorites only" filter is active */
  favOnlyActive: false,

  /** Repos visible in the feed list (may be filtered) */
  currentRepos: /** @type {object[]} */ ([]),

  /** All repos loaded across pages (used by wordcloud) */
  allRepos: /** @type {object[]} */ ([]),

  /** "daily" | "weekly" | "monthly" */
  feedKind: localStorage.getItem(LS_FEED_KIND) || "daily",
};

// ─── Setters with side-effects ────────────────────────────────────────────────

export function setLang(code) {
  state.currentLang = code;
  localStorage.setItem(LS_PREF_LANG, code);
}

export function setFeedKindState(kind) {
  state.feedKind = kind;
  localStorage.setItem(LS_FEED_KIND, kind);
}
