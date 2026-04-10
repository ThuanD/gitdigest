// ─── LocalStorage Keys ────────────────────────────────────────────────────────
export const LS_READ_STATS = "readStats";
export const LS_READ_REPOS = "readRepos";
export const LS_FEED_KIND = "gitdigest_feed_kind";
export const LS_PREF_LANG = "preferredLang";
export const LS_API_KEY = "api_key";
export const LS_AI_PROVIDER = "ai_provider";
export const LS_AI_MODEL = "ai_model";
export const LS_CHAT_HISTORY = "chat_history";
export const LS_WORDCLOUD_CACHE = "wordcloud_cache";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "ENG" },
  { code: "vi", name: "VN" },
];

// ─── Spinner ──────────────────────────────────────────────────────────────────
export const SPINNER_SVG = `<svg class="animate-spin h-3.5 w-3.5 text-hn shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

// ─── DOMPurify allowlist ──────────────────────────────────────────────────────
export const MD_SANITIZE = {
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

// ─── Error definitions ────────────────────────────────────────────────────────
export const ERROR_MAP = {
  no_api_key: {
    title: "API Key Required",
    hint: "Add your OpenAI, Groq, or Gemini API key in Settings to generate summaries.",
    action: "settings",
    statusText: "Add API key in settings",
    statusColor: "bg-amber-500",
  },
  invalid_api_key: {
    title: "Invalid API Key",
    hint: "The key you provided was rejected by the AI provider. Please check it in Settings.",
    action: "settings",
    statusText: "Invalid API key — check settings",
    statusColor: "bg-amber-500",
  },
  rate_limit: {
    title: "Rate Limit Reached",
    hint: "Your API key has hit its request-rate limit. Wait a moment, then try again.",
    action: null,
    statusText: "Rate limit — try again shortly",
    statusColor: "bg-yellow-500",
  },
  quota_exceeded: {
    title: "API Quota Exceeded",
    hint: "Your API key has run out of credits or reached its monthly quota.",
    action: null,
    statusText: "Quota exceeded",
    statusColor: "bg-red-500",
  },
  forbidden: {
    title: "API Access Denied",
    hint: "The API key does not have permission for this operation.",
    action: null,
    statusText: "Access denied",
    statusColor: "bg-red-500",
  },
  not_found: {
    title: "Repository Not Found",
    hint: "GitHub could not find this repository.",
    action: null,
    statusText: "Repository not found",
    statusColor: "bg-red-500",
  },
  github_rate_limit: {
    title: "GitHub Rate Limit",
    hint: "GitHub's API is temporarily rate-limiting this server. Try again in a few minutes.",
    action: null,
    statusText: "GitHub rate limit — try again",
    statusColor: "bg-yellow-500",
  },
  no_summary: {
    title: "Summary Not Ready",
    hint: "Generate the summary first, then try asking questions.",
    action: null,
    statusText: "No summary yet",
    statusColor: "bg-amber-500",
  },
  server_error: {
    title: "Server Error",
    hint: "An unexpected error occurred on the server. Please try again.",
    action: null,
    statusText: "Server error",
    statusColor: "bg-red-500",
  },
};

// ─── Chat preset questions ────────────────────────────────────────────────────
export const CHAT_QUESTIONS_EN = [
  {
    id: "trending_analysis",
    label: "🔥 Why trending?",
    question:
      "Why is this project currently trending? Analyze its unique selling point, what gap in the ecosystem it fills, and why developers are excited about it right now compared to established alternatives.",
  },
  {
    id: "fork_utility",
    label: "🍴 Fork use cases?",
    question:
      "What do developers typically do after forking this repo? Is it primarily used as a learning reference, a base for customization, or a production-ready boilerplate? What signals in the codebase support your answer?",
  },
  {
    id: "practicality",
    label: "🏭 Production ready?",
    question:
      "Is this just a cool experiment or is it ready for real-world production? Give an honest assessment of maturity, test coverage signals, release cadence, and the most important trade-offs if someone deploys it today.",
  },
  {
    id: "tech_stack",
    label: "🏗️ Tech stack?",
    question:
      "What are the core technologies and key architectural decisions in this project? How are the main components decoupled or integrated? Highlight anything unconventional or particularly elegant.",
  },
  {
    id: "quick_start",
    label: "🚀 Quick start?",
    question:
      "What is the fastest way to get a working demo running locally? Are there any hidden prerequisites, non-obvious setup steps, or common stumbling blocks a developer should know before starting?",
  },
  {
    id: "best_practices",
    label: "🎓 Best practices?",
    question:
      "What high-quality coding patterns, design decisions, or software engineering practices are demonstrated in this codebase that a developer should study? What makes this code worth reading?",
  },
  {
    id: "limitations",
    label: "⚠️ Limitations?",
    question:
      "What can this project NOT do yet? List the biggest technical limitations, missing features, scalability ceilings, or known edge cases that could cause problems when extending or scaling it.",
  },
  {
    id: "issue_health",
    label: "🐛 Project health?",
    question:
      "Based on the open issues and repository signals, what is the overall health of this project? Are there any critical unresolved bugs, long-standing pain points, known CVEs, or security concerns?",
  },
];

export const CHAT_QUESTIONS_VI = [
  {
    id: "trending_analysis",
    label: "🔥 Tại sao trending?",
    question:
      "Tại sao repo này đang trending? Phân tích điểm bán hàng độc đáo, khoảng trống trong hệ sinh thái mà nó lấp đầy, và tại sao lập trình viên hào hứng với nó ngay bây giờ so với các lựa chọn thay thế đã có.",
  },
  {
    id: "fork_utility",
    label: "🍴 Fork để làm gì?",
    question:
      "Lập trình viên thường dùng fork để làm gì? Chủ yếu được dùng làm tài liệu tham khảo, cơ sở để tùy chỉnh, hay boilerplate sẵn sàng cho production? Những tín hiệu nào trong codebase hỗ trợ câu trả lời?",
  },
  {
    id: "practicality",
    label: "🏭 Production chưa?",
    question:
      "Đây chỉ là một thử nghiệm thú vị hay đã sẵn sàng cho production thực tế? Đưa ra đánh giá trung thực về độ trưởng thành, tín hiệu test coverage, tần suất release, và những đánh đổi quan trọng nhất nếu ai đó deploy hôm nay.",
  },
  {
    id: "tech_stack",
    label: "🏗️ Tech stack?",
    question:
      "Công nghệ cốt lõi và quyết định kiến trúc chính trong project này? Các thành phần chính được tách rời hay tích hợp như thế nào? Nêu bật điều gì không thông thường hoặc đặc biệt thanh lịch.",
  },
  {
    id: "quick_start",
    label: "🚀 Bắt đầu nhanh?",
    question:
      "Cách nhanh nhất để chạy demo? Có những yêu cầu tiềm ẩn, bước thiết lập không rõ ràng, hay trở ngại phổ biến nào mà lập trình viên nên biết trước khi bắt đầu?",
  },
  {
    id: "best_practices",
    label: "🎓 Best practices?",
    question:
      "Mẫu coding chất lượng cao, quyết định thiết kế, hay thực hành kỹ thuật phần mềm nào được thể hiện trong codebase này mà lập trình viên nên học? Điều gì làm code này đáng đọc?",
  },
  {
    id: "limitations",
    label: "⚠️ Hạn chế?",
    question:
      "Project này KHÔNG thể làm gì? Liệt kê những hạn chế kỹ thuật lớn nhất, tính năng còn thiếu, trần scalability, hay trường hợp edge đã biết có thể gây vấn đề khi mở rộng hay scaling nó.",
  },
  {
    id: "issue_health",
    label: "🐛 Sức khỏe dự án?",
    question:
      "Dựa trên các issue mở và tín hiệu repository, sức khỏe tổng thể của project này là gì? Có bug nghiêm trọng chưa giải quyết, điểm đau dai dẳng, CVE đã biết, hay lo ngại bảo mật nào không?",
  },
];

export const WC_CHAT_QUESTIONS_EN = [
  {
    id: "wc_hottest",
    label: "🔥 Hottest tech?",
    question:
      "What are the hottest technologies in this period's trending repos, and why are they dominating?",
  },
  {
    id: "wc_learn",
    label: "📚 What to learn next?",
    question:
      "Based on these trending technologies, what should a developer focus on learning to stay current?",
  },
  {
    id: "wc_emerging",
    label: "🚀 What's emerging?",
    question:
      "Which technologies or concepts are emerging and likely to become more important in the near future?",
  },
  {
    id: "wc_common",
    label: "🔗 Common patterns?",
    question:
      "What do these trending repositories have in common? What patterns or themes are shared across them?",
  },
];

export const WC_CHAT_QUESTIONS_VI = [
  {
    id: "wc_hottest",
    label: "🔥 Công nghệ nổi bật?",
    question:
      "Công nghệ nào đang nổi bật nhất trong các repo trending kỳ này, và tại sao chúng chiếm ưu thế?",
  },
  {
    id: "wc_learn",
    label: "📚 Nên học gì tiếp theo?",
    question:
      "Dựa trên các công nghệ trending, lập trình viên nên tập trung học gì để theo kịp xu hướng?",
  },
  {
    id: "wc_emerging",
    label: "🚀 Xu hướng nổi lên?",
    question:
      "Công nghệ hoặc khái niệm nào đang nổi lên và có khả năng trở nên quan trọng hơn trong tương lai gần?",
  },
  {
    id: "wc_common",
    label: "🔗 Điểm chung là gì?",
    question:
      "Các repo trending này có điểm gì chung? Những mẫu hoặc chủ đề nào được chia sẻ giữa chúng?",
  },
];
