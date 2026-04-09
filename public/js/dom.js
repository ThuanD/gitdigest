/** Single source of truth for all queried DOM nodes. */

const q = (id) => document.getElementById(id);

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settingsModal = q("settingsModal");
export const openSettingsBtn = q("openSettingsBtn");
export const closeSettingsBtn = q("closeSettingsBtn");
export const saveKeyBtn = q("saveKeyBtn");
export const clearKeyBtn = q("clearKeyBtn");
export const apiKeyInput = q("apiKeyInput");
export const providerSelect = q("providerSelect");
export const modelInput = q("modelInput");
export const modelHint = q("modelHint");
export const langSelect = q("langSelect");

// ─── Status bar ───────────────────────────────────────────────────────────────
export const statusDot = q("statusDot");
export const statusTextEl = q("statusText");

// ─── Feed ─────────────────────────────────────────────────────────────────────
export const feedList = q("feedList");
export const loadMoreBtn = q("loadMoreBtn");
export const feedPane = q("feedPane");
export const emptyState = q("emptyState");
export const activityGraph = q("activityGraph");

// ─── Feed-kind buttons ────────────────────────────────────────────────────────
export const feedKindDaily = q("feedKindDaily");
export const feedKindWeekly = q("feedKindWeekly");
export const feedKindMonthly = q("feedKindMonthly");

// ─── Hide-read toggle ─────────────────────────────────────────────────────────
export const hideReadToggle = q("hideReadToggle");
export const toggleKnob = q("toggleKnob");

// ─── Reader pane ──────────────────────────────────────────────────────────────
export const readerPane = q("readerPane");
export const readerContent = q("readerContent");
export const readerWorkspace = q("readerWorkspace");
export const readerTitle = q("readerTitle");
export const readerTitleSourceLink = q("readerTitleSourceLink");
export const readerStatus = q("readerStatus");
export const readerBody = q("readerBody");
export const readerPostSlot = q("readerPostSlot");
export const readerViewToggle = q("readerViewToggle");
export const readerViewSummaryBtn = q("readerViewSummaryBtn");
export const readerViewSourceBtn = q("readerViewSourceBtn");
export const readerCommentsToggleWrap = q("readerCommentsToggleWrap");
export const readerChatBtn = q("readerChatBtn");
export const mobileBackBtn = q("mobileBackBtn");

// ─── Source panel ─────────────────────────────────────────────────────────────
export const sourceFramePanel = q("sourceFramePanel");
export const readerSourceIframeWrap = q("readerSourceIframeWrap");

// ─── Comments / chat panel ────────────────────────────────────────────────────
export const commentsPane = q("commentsPane");
export const commentsBody = q("commentsBody");
export const commentsBackdrop = q("commentsBackdrop");
export const closeCommentsBtn = q("closeCommentsBtn");

// ─── Wordcloud ────────────────────────────────────────────────────────────────
export const wordcloudView = q("wordcloudView");
export const wordcloudBtn = q("wordcloudBtn");
export const wordcloudClearBtn = q("wordcloudClearBtn");
export const wordcloudModal = q("wordcloudModal");
export const closeWordcloudBtn = q("closeWordcloudBtn");
export const wordcloudPeriod = q("wordcloudPeriod");
export const wordcloudCanvas = q("wordcloudCanvas");
export const wordcloudLoading = q("wordcloudLoading");
export const wordcloudStatus = q("wordcloudStatus");
export const wordcloudCategories = q("wordcloudCategories");
export const wordcloudInsights = q("wordcloudInsights");
export const wordcloudTrends = q("wordcloudTrends");
