// ─── Constants & Cache Configuration ──────────────────────────────────────────────
const LIST_CACHE_TTL = 30 * 60 * 1000;
const SUMMARY_CACHE_MAX = 500; // max entries (was mistakenly set to TTL ms)
const REPO_CACHE_MAX = 200; // max entries (was mistakenly set to TTL ms)
const WORDCLOUD_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const WORDCLOUD_CACHE_MAX = 100; // max entries

const listIdCaches = new Map(); // key: "period-language" — was plain object, lookup never matched
const summaryCache = new Map();
const repoCache = new Map();
const wordcloudCache = new Map();

// ─── Custom exceptions ──────────────────────────────────────────────
class RateLimitError extends Error {}
class NotFoundError extends Error {}

/**
 * Thrown when the upstream AI provider returns an error.
 * `errorCode` is a stable machine-readable token forwarded to the client.
 * `httpStatus` is the HTTP status the worker should use in its own response.
 *
 * errorCode values:
 *   no_api_key        – no key was supplied at all
 *   invalid_api_key   – provider returned 401
 *   rate_limit        – provider returned 429 (request rate)
 *   quota_exceeded    – provider returned 429 with quota/billing message
 *   forbidden         – provider returned 403
 *   ai_error          – any other non-OK response from the AI provider
 */
class AIApiError extends Error {
  constructor(message, { errorCode = "ai_error", httpStatus = 502 } = {}) {
    super(message);
    this.name = "AIApiError";
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
  }
}

// ─── Utility Functions Module ────────────────────────────────────────────────────
/**
 * General utility functions and data transformations
 * Reusable helpers across the application
 */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpenAI-Key",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function openAiKeyFromRequest(request) {
  const authHeader = (request.headers.get("authorization") || "").trim();
  let m = authHeader.match(/^Bearer\s+([\s\S]+)$/i);
  let token = (m?.[1] || "").trim();
  while (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }
  if (token) return token;
  return (request.headers.get("x-openai-key") || "").trim();
}

function summaryCacheSet(key, value) {
  if (summaryCache.size >= SUMMARY_CACHE_MAX && !summaryCache.has(key)) {
    const first = summaryCache.keys().next().value;
    summaryCache.delete(first);
  }
  summaryCache.set(key, value);
}

function repoCacheSet(key, value) {
  if (repoCache.size >= REPO_CACHE_MAX && !repoCache.has(key)) {
    const first = repoCache.keys().next().value;
    repoCache.delete(first);
  }
  repoCache.set(key, value);
}

function wordcloudCacheSet(key, value) {
  if (wordcloudCache.size >= WORDCLOUD_CACHE_MAX && !wordcloudCache.has(key)) {
    const first = wordcloudCache.keys().next().value;
    wordcloudCache.delete(first);
  }
  wordcloudCache.set(key, { data: value, time: Date.now() });
}

function safeParseJson(raw) {
  if (!raw) return null;
  // Strip ```json ... ``` or ``` ... ```
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(stripped);
}

// ─── Data Mapping Module ────────────────────────────────────────────────────────
/**
 * Data transformation utilities
 * Convert between different data formats and APIs
 */

function mapTrendingRepository(repo) {
  const parseNum = (str = "") =>
    parseInt((str || "").replace(/,/g, "").trim(), 10) || 0;

  const starsToday = parseNum(
    (repo._todayRaw || "").replace(/stars today/i, "").trim(),
  );

  return {
    id: repo.fullName,
    fullName: repo.fullName,
    url: repo.url,
    name: repo.name,
    owner: repo.owner,
    description: repo.description.trim(),
    language: repo.language.trim(),
    stars: parseNum(repo._starsRaw),
    forks: parseNum(repo._forksRaw),
    starsToday,
  };
}

function mapGitHubRepo(repo) {
  return {
    id: repo.full_name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
    createdAt: Math.floor(new Date(repo.created_at).getTime() / 1000),
    pushedAt: Math.floor(new Date(repo.pushed_at).getTime() / 1000),
    description: repo.description,
    language: repo.language,
    topics: repo.topics || [],
    forks: repo.forks_count,
    readmeUrl: `${repo.html_url}/blob/main/README.md`,
  };
}

function mapRepoIssue(issue) {
  return {
    title: issue.title,
    labels: issue.labels,
    html_url: issue.html_url,
    number: issue.number,
    user: issue.user,
    comments: issue.comments,
    state: issue.state,
    created_at: issue.created_at,
  };
}

// ─── GitHub API Module ────────────────────────────────────────────────────────
/**
 * GitHub API integration utilities
 * Centralized GitHub API calls with error handling
 */

async function parseTrendingPage(response) {
  const repos = [];
  let current = null;

  const rewriter = new HTMLRewriter()
    .on("article.Box-row", {
      element() {
        current = {
          fullName: "",
          name: "",
          owner: "",
          url: "",
          description: "",
          language: "",
          stars: 0,
          forks: 0,
          starsToday: 0,
        };
        repos.push(current);
      },
    })
    .on("article.Box-row h2 a", {
      element(el) {
        if (!current) return;
        const href = el.getAttribute("href") || "";
        current.fullName = href.replace(/^\//, "");
        current.url = `https://github.com${href}`;
        const parts = current.fullName.split("/");
        current.name = parts[1] || current.fullName;
        current.owner = parts[0] || "";
      },
    })
    .on("article.Box-row p.col-9", {
      text(chunk) {
        if (!current) return;
        current.description += chunk.text;
      },
    })
    .on("article.Box-row [itemprop='programmingLanguage']", {
      text(chunk) {
        if (!current) return;
        current.language += chunk.text;
      },
    })
    .on("article.Box-row a[href$='/stargazers']", {
      text(chunk) {
        if (!current) return;
        current._starsRaw = (current._starsRaw || "") + chunk.text;
      },
    })
    .on("article.Box-row a[href$='/forks']", {
      text(chunk) {
        if (!current) return;
        current._forksRaw = (current._forksRaw || "") + chunk.text;
      },
    })
    .on("article.Box-row .d-inline-block.float-sm-right", {
      text(chunk) {
        if (!current) return;
        current._starsTodayRaw = (current._starsTodayRaw || "") + chunk.text;
      },
    });

  await rewriter.transform(response).arrayBuffer();

  return repos.map(mapTrendingRepository);
}

async function fetchTrendingRepos(period, language, env) {
  const sinceMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
  const since = sinceMap[period] || "daily";
  const cacheKey = `${period}-${language}`;

  const cached = listIdCaches.get(cacheKey);
  let repos = cached?.repos;

  if (
    !repos ||
    repos.length === 0 ||
    Date.now() - (cached?.time ?? 0) > LIST_CACHE_TTL
  ) {
    cacheStats.listCacheMisses++;
    const trendingUrl = `https://github.com/trending/${encodeURIComponent(language)}?since=${since}`;

    const res = await fetch(trendingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TrendingBot/1.0)",
        Accept: "text/html",
      },
    });

    if (!res.ok) throw new Error(`GitHub trending fetch failed: ${res.status}`);

    repos = await parseTrendingPage(res);
    if (!repos || repos.length === 0) {
      throw new Error(
        "Parsed 0 repos — GitHub HTML structure may have changed",
      );
    }
    listIdCaches.set(cacheKey, { time: Date.now(), repos });
  } else {
    cacheStats.listCacheHits++;
  }
  
  return repos;
}

async function fetchGitHubRepo(repoId, env) {
  try {
    const cached = repoCache.get(repoId);

    if (cached && Date.now() - cached.time < LIST_CACHE_TTL) {
      cacheStats.repoCacheHits++;
      return { repo: cached.repo, isCached: true };
    }

    cacheStats.repoCacheMisses++;

    const repoUrl = `https://api.github.com/repos/${repoId}`;
    const response = await fetch(repoUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Digest-Worker",
        ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
      },
    });

    if (!response.ok) {
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.message?.includes("rate limit")) {
          throw new RateLimitError("GitHub API rate limit exceeded");
        }
      }
      if (response.status === 404) {
        throw new NotFoundError("Repository not found");
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const repoRes = await response.json();
    const repo = mapGitHubRepo(repoRes);
    repoCacheSet(repoId, { repo, time: Date.now() });

    return { repo, isCached: false };
  } catch (error) {
    console.error("Failed to load GitHub repo:", error);
    return [];
  }
}

async function fetchGitHubIssues(repoId, env) {
  try {
    let isRepoCached = false;
    const cached = repoCache.get(repoId);
    if (cached && Date.now() - cached.time < LIST_CACHE_TTL) {
      if (cached.issues) {
        return { issues: cached.issues, isCached: true };
      }
      isRepoCached = true;
    }

    const issuesUrl = `https://api.github.com/repos/${repoId}/issues?state=open&sort=created&direction=desc&per_page=25`;
    const response = await fetch(issuesUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Digest-Worker",
        ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
      },
    });

    if (!response.ok) {
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.message?.includes("rate limit")) {
          throw new RateLimitError("GitHub API rate limit exceeded");
        }
      }
      if (response.status === 404) {
        throw new NotFoundError("Repository not found or no issues");
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issues = await response.json();
    const issueData = issues.map(mapRepoIssue);

    if (isRepoCached) {
      repoCacheSet(repoId, { ...cached, issues: issueData });
    }
    return issueData;
  } catch (error) {
    console.error("Failed to load GitHub issues:", error);
    return [];
  }
}

// ─── README Processing Module ──────────────────────────────────────────────────
/**
 * README content processing and rendering utilities
 * Handles GitHub markdown API, media URL resolution, and content sanitization
 */

function decodeBase64(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function resolveMediaUrls(html, fullName, defaultBranch = "main") {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;
  return (
    html
      // Handle <img> tags with double quotes
      .replace(
        /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<img${before} src="${base}/${cleanSrc}"${after}>`;
        },
      )
      // Handle <img> tags with single quotes
      .replace(
        /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<img${before} src='${base}/${cleanSrc}'${after}>`;
        },
      )
      // Handle <video> tags with double quotes
      .replace(
        /<video([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<video${before} src="${base}/${cleanSrc}"${after}>`;
        },
      )
      // Handle <video> tags with single quotes
      .replace(
        /<video([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<video${before} src='${base}/${cleanSrc}'${after}>`;
        },
      )
      // Handle <source> tags inside <video> with double quotes
      .replace(
        /<source([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<source${before} src="${base}/${cleanSrc}"${after}>`;
        },
      )
      // Handle <source> tags inside <video> with single quotes
      .replace(
        /<source([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
        (_, before, src, after) => {
          const cleanSrc = src.replace(/^\.\//, "");
          return `<source${before} src='${base}/${cleanSrc}'${after}>`;
        },
      )
  );
}

function stripBadgeLineBreaks(html) {
  // Remove <br> tags inserted between consecutive badge/image links
  // GitHub API adds <br> for each newline inside a paragraph, but the
  // website renderer treats them as inline — we need to match that behaviour
  return html.replace(/<\/a>\s*<br\s*\/?>\s*(<a\s)/gi, "</a>\n$1");
}

async function renderGitHubMarkdown(content, fullName, env) {
  try {
    const response = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitDigest-Worker",
        ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
      },
      body: JSON.stringify({
        text: content,
        mode: "gfm",
        context: fullName,
      }),
    });

    if (response.ok) {
      const html = await response.text();
      return html; // Will be processed by resolveMediaUrls
    }
    return null;
  } catch (error) {
    console.warn("GitHub markdown render failed:", error.message);
    return null;
  }
}

async function fetchAndRenderReadme(repo, env, forAI = false) {
  let readmeContent = "";
  let readmeHtml = "";

  try {
    // Fetch README content
    const response = await fetch(
      `https://api.github.com/repos/${repo.fullName}/readme`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GitDigest-Worker",
          ...(env.GITHUB_TOKEN && {
            Authorization: `token ${env.GITHUB_TOKEN}`,
          }),
        },
      },
    );

    if (response.ok) {
      const readmeData = await response.json();
      readmeContent = decodeBase64(readmeData.content);

      // Render to HTML using GitHub's API
      readmeHtml = await renderGitHubMarkdown(
        readmeContent,
        repo.fullName,
        env,
      );

      // Resolve media URLs if HTML was rendered
      if (readmeHtml) {
        readmeHtml = resolveMediaUrls(
          readmeHtml,
          repo.fullName,
          repo.default_branch,
        );
        readmeHtml = stripBadgeLineBreaks(readmeHtml);
      }

      // For AI summary, process content to be more concise
      if (forAI && readmeContent) {
        readmeContent = readmeContent
          .replace(/```[\s\S]*?```/g, "[CODE BLOCK]")
          .replace(/`[^`]*`/g, "[CODE]")
          .replace(/!\[.*?\]\(.*?\)/g, "[IMAGE]")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/#{1,6}\s*/g, "")
          .replace(/\*\*([^*]*)\*\*/g, "$1")
          .replace(/\*([^*]*)\*/g, "$1")
          .replace(/\n+/g, " ")
          .substring(0, 8000);
      }
    }
  } catch (readmeError) {
    console.error("README fetch failed:", readmeError.message);
  }

  return { readmeContent, readmeHtml };
}

// ─── AI/LLM Processing Module ───────────────────────────────────────────────────
/**
 * AI service integration and prompt engineering
 * Handles OpenAI API calls and response processing
 */

function buildSummarizePrompt(content, lang, repo) {
  const systemPrompt = `You are a senior software engineer and technical writer reviewing GitHub repositories for a developer audience.

## Output Language
Write the ENTIRE response in the language matching ISO code: '${lang}' — including all headings, labels, bullet points, and prose.

## Response Structure (use this exact order)
### 🔍 Overview
One concise paragraph: what the project is, its core purpose, and the problem it solves.

### ⚙️ Technical Stack
- Primary language & runtime
- Key frameworks, libraries, dependencies
- Architecture pattern (e.g. microservice, CLI tool, SDK, plugin, etc.)

### ✨ Key Features
3-6 bullet points highlighting the most impactful or distinctive capabilities.

### 🎯 Use Cases
Who would use this and in what scenarios. Be specific (e.g. "backend developers needing X", not just "developers").

### 📈 Traction & Signals
Interpret the star count and forks in context of the repo's age and domain. Note any notable topics or community indicators.

### 💡 Why It Stands Out
1-2 sentences on what makes this repo notable compared to alternatives, or why it's gaining attention now.

## Tone & Formatting Rules
- Be precise and technical — avoid vague marketing language like "powerful" or "easy to use" without evidence.
- Use **bold** only for proper nouns, library names, and critical terms.
- Target length: 350-550 words. Prioritize clarity over completeness.
- If README is missing or sparse, reason from the repo metadata and tech stack — clearly note when you're inferring.`;

  const userPrompt = `Analyze the following GitHub repository and produce a structured technical summary for developers evaluating whether to use or follow this project.

${content}

${JSON.stringify(repo, null, 2)}

Focus on actionable insight: what exactly does this do, how is it built, and why should a developer care?`;

  return { systemPrompt, userPrompt };
}

function buildWordcloudPrompt(repos, period, language) {
  const systemPrompt = `You are a technology intelligence analyst specializing in open source trends.

Your task: analyze GitHub trending repositories and return a structured JSON object for a word cloud visualization.

## Analysis Strategy
- Extract technical terms: languages, frameworks, libraries, domains, architectural concepts
- Normalize variants: "machine-learning", "ml", "machine learning" → "machine-learning"
- Suppress noise: ignore generic words (tool, project, simple, awesome, build, based, use, support, fast, easy, new, app, make, help, open, data, list)
- Infer domain clusters from co-occurring signals (e.g. "llm" + "rag" + "agent" → AI cluster)
- Weight by: repo count mentioning term + star velocity (starsToday) + total stars

## Categorization Rules
- "language"   → programming/scripting language (python, rust, go, typescript …)
- "framework"  → library or framework (react, pytorch, fastapi, langchain …)
- "domain"     → problem space (ai/ml, devops, security, web, mobile, data …)
- "concept"    → architectural or paradigm term (rag, agent, microservice, wasm, cli …)

## JSON Schema (return ONLY this, no markdown fences, no explanation)
{
  "words": [
    {
      "text": string,          // lowercase, hyphenated if multi-word
      "size": number,          // 10-30 scaled by weight
      "category": "language" | "framework" | "domain" | "concept",
      "repos": number,         // how many repos this term appears in
      "weight": number         // raw weight score
    }
  ],
  "categories": {
    "languages":  { "count": number, "totalWeight": number },
    "frameworks": { "count": number, "totalWeight": number },
    "domains":    { "count": number, "totalWeight": number },
    "concepts":   { "count": number, "totalWeight": number }
  },
  "insights": [string],        // 3-5 analyst-grade observations, specific and data-backed
  "trends": {
    "emerging":    [string],   // gaining fast, low base
    "established": [string],   // consistently dominant
    "rising":      [string]    // growing steadily
  }
}

## Hard Constraints
- words array: 20-50 entries, no duplicates
- text: minimum 2 characters, no punctuation except hyphens
- size: must be integer in [10, 30]
- insights: reference actual numbers (e.g. "12 of 25 repos use Python"), no vague claims
- Return ONLY valid JSON — no markdown, no prose, no code fences`;

  const userPrompt = `Analyze the following ${repos.length} GitHub trending repositories (${period} / lang filter: "${language || "all"}").

${JSON.stringify(repos, null, 2)}

Return the JSON object. No markdown, no explanation.`;

  return { systemPrompt, userPrompt };
}

async function callOpenAI(systemPrompt, userPrompt, apiKey) {
  let apiUrl, requestBody;

  if (apiKey.startsWith("gsk_")) {
    apiUrl = "https://api.groq.com/openai/v1/chat/completions";
    requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.45,
      max_tokens: 4096,
    };
  } else if (apiKey.startsWith("sk-")) {
    apiUrl = "https://api.openai.com/v1/chat/completions";
    requestBody = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.45,
      max_tokens: 4096,
    };
  } else {
    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
    requestBody = {
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.45, maxOutputTokens: 4096 },
    };
  }

  const headers = { "Content-Type": "application/json" };
  if (!apiKey.startsWith("AIza")) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  const aiData = await response.json();

  if (!response.ok) {
    const status = response.status;
    const errMsg =
      aiData.error?.message ||
      (aiData.error ? JSON.stringify(aiData.error) : `AI API error ${status}`);

    let errorCode = "ai_error";
    let httpStatus = 502; // Bad Gateway — upstream AI provider failed

    if (status === 401) {
      errorCode = "invalid_api_key";
      httpStatus = 401;
    } else if (status === 429) {
      const isQuota =
        aiData.error?.code === "insufficient_quota" ||
        errMsg.toLowerCase().includes("quota") ||
        errMsg.toLowerCase().includes("billing") ||
        errMsg.toLowerCase().includes("exceeded your current quota");
      errorCode = isQuota ? "quota_exceeded" : "rate_limit";
      httpStatus = 429;
    } else if (status === 403) {
      errorCode = "forbidden";
      httpStatus = 403;
    }

    console.error(`AI API error [${status}/${errorCode}]:`, errMsg);
    throw new AIApiError(errMsg, { errorCode, httpStatus });
  }

  if (aiData.error) {
    const errMsg = aiData.error.message || JSON.stringify(aiData.error);
    console.error("AI API returned error body:", errMsg);
    throw new AIApiError(errMsg, { errorCode: "ai_error", httpStatus: 502 });
  }

  const data = apiKey.startsWith("AIza")
    ? aiData.candidates?.[0]?.content?.parts?.[0]?.text
    : aiData.choices?.[0]?.message?.content;
  if (!data) throw new Error("No content received from API");

  return data;
}

// ─── WordCloud Analysis Module ───────────────────────────────────────────────────
/**
 * Trend analysis and wordcloud generation
 * AI-powered keyword extraction and categorization
 */

// ─── API Handlers Module ───────────────────────────────────────────────────────
/**
 * HTTP request handlers for all API endpoints
 * Request validation, response formatting, and error handling
 */

async function handleRepos(request, url, env) {
  try {
    const period = url.searchParams.get("period") || "daily";
    const language = url.searchParams.get("lang") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = 15;

    const repos = await fetchTrendingRepos(period, language, env);
    const startIndex = (page - 1) * limit;
    const pageRepos = repos.slice(startIndex, startIndex + limit);

    return json({
      repos: pageRepos,
      hasMore: startIndex + limit < repos.length,
      feed: period,
    });
  } catch (error) {
    console.error("Trending fetch error:", error);
    return json({ error: "Failed to fetch trending repositories" }, 500);
  }
}

async function handleRepoDetails(request, url, env) {
  try {
    const repoId = url.searchParams.get("repoId");
    if (!repoId) {
      return json({ error: "Missing repository ID" }, 400);
    }

    const { repo, isCached } = await fetchGitHubRepo(repoId, env);

    // Fetch and render README using the new function
    const { readmeContent, readmeHtml } = await fetchAndRenderReadme(repo, env);

    const result = {
      ...mapGitHubRepo(repo),
      readmeContent: readmeContent,
      readmeHtml: readmeHtml,
      rawApiResponse: repo,
      isCached,
    };

    repoCacheSet(repoId, { t: Date.now(), result });
    return json(result);
  } catch (error) {
    if (error instanceof NotFoundError)
      return json({ error: error.message }, 404);
    if (error instanceof RateLimitError)
      return json({ error: error.message }, 429);

    console.error("Repo details fetch error:", error);
    return json({ error: "Failed to fetch repository details." }, 500);
  }
}

async function handleGitHubIssues(request, url, env) {
  try {
    const repoId = url.searchParams.get("repoId");
    if (!repoId) {
      return json({ error: "Missing repository ID" }, 400);
    }

    const issues = await fetchGitHubIssues(repoId, env);

    return json({
      issues,
      repo_url: `https://github.com/${repoId}`,
      count: issues.length,
    });
  } catch (error) {
    console.error("GitHub Issues fetch error:", error);
    return json({ error: "Failed to fetch issues" }, 500);
  }
}

async function handleSummarize(request, url, env) {
  try {
    const repoId = url.searchParams.get("repoId");
    if (!repoId) {
      return json({ error: "Missing repository ID", errorCode: "bad_request" }, 400);
    }

    const lang = (url.searchParams.get("lang") || "en").slice(0, 12);

    // Client key takes priority; fall back to server-configured key.
    const clientKey = openAiKeyFromRequest(request);
    const apiKey = clientKey || (env.OPENAI_API_KEY || "").trim();

    if (!apiKey) {
      return json(
        {
          error: "No API key configured. Add your API key in settings.",
          errorCode: "no_api_key",
        },
        401,
      );
    }

    // Check cache first
    const cacheKey = `${repoId}_${lang}`;
    if (summaryCache.has(cacheKey)) {
      cacheStats.summaryCacheHits++;
      return json({ summary: summaryCache.get(cacheKey), isCached: true });
    }

    cacheStats.summaryCacheMisses++;

    // Smart strategy: translate an existing opposite-language summary if available
    const oppositeLang = lang === "en" ? "vi" : "en";
    const oppositeCacheKey = `${repoId}_${oppositeLang}`;

    if (summaryCache.has(oppositeCacheKey)) {
      const existingSummary = summaryCache.get(oppositeCacheKey);
      const translatedSummary = await translateSummary(existingSummary, lang, env);

      if (translatedSummary) {
        summaryCacheSet(cacheKey, translatedSummary);
        return json({ summary: translatedSummary, isTranslated: true, fromLang: oppositeLang });
      }
    }

    // Generate new summary
    const summary = await generateSummary(repoId, lang, apiKey, env);
    summaryCacheSet(cacheKey, summary);
    return json({ summary, isGenerated: true });

  } catch (error) {
    // AI provider errors: forward the provider's status and a machine-readable code
    if (error instanceof AIApiError) {
      return json({ error: error.message, errorCode: error.errorCode }, error.httpStatus);
    }
    if (error instanceof NotFoundError) {
      return json({ error: error.message, errorCode: "not_found" }, 404);
    }
    if (error instanceof RateLimitError) {
      return json({ error: error.message, errorCode: "github_rate_limit" }, 429);
    }
    console.error("Summarize error:", error);
    return json(
      { error: error.message || "Internal server error", errorCode: "server_error" },
      500,
    );
  }
}

// ─── Translation Module ───────────────────────────────────────────────────────
async function translateSummary(text, targetLang, env) {
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const prompt = targetLang === "vi" 
      ? `Translate the following English text to Vietnamese. Keep the meaning and tone:\n\n${text}`
      : `Translate the following Vietnamese text to English. Keep the meaning and tone:\n\n${text}`;

    const response = await callOpenAI(
      "You are a professional translator. Translate accurately while preserving the original meaning and tone.",
      prompt,
      apiKey
    );

    return response;
  } catch (error) {
    console.error("Translation error:", error);
    return null;
  }
}

async function translateWordCloud(wordcloudData, targetLang, env) {
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return null;

    // Extract words to translate
    const words = wordcloudData.words || [];
    const wordTexts = words.map(w => w.text).join(", ");

    const prompt = targetLang === "vi" 
      ? `Translate the following English keywords to Vietnamese. Return as JSON array: ["translated1", "translated2", ...]\n\nKeywords: ${wordTexts}`
      : `Translate the following Vietnamese keywords to English. Return as JSON array: ["translated1", "translated2", ...]\n\nKeywords: ${wordTexts}`;

    const response = await callOpenAI(
      "You are a professional translator. Translate keywords accurately. Return only JSON array.",
      prompt,
      apiKey
    );

    let translatedWords;
    try {
      translatedWords = JSON.parse(response);
    } catch {
      // Fallback: simple split if JSON parsing fails
      translatedWords = response.split(",").map(w => w.trim().replace(/['"]/g, ''));
    }

    // Map translations back to original structure
    const translatedWordcloud = {
      ...wordcloudData,
      words: words.map((word, index) => ({
        ...word,
        text: translatedWords[index] || word.text
      }))
    };

    return translatedWordcloud;
  } catch (error) {
    console.error("WordCloud translation error:", error);
    return null;
  }
}

// ─── Summary Generation Module ───────────────────────────────────────────────────
// apiKey is required — callers must resolve (client key || env key) before calling.
async function generateSummary(repoId, lang, apiKey, env) {

  const { repo, _ } = await fetchGitHubRepo(repoId, env);

  // Fetch and render README
  const { readmeContent, _readmeHtml } = await fetchAndRenderReadme(repo, env, true);

  let contentToSummarize = `Repository: ${repo.fullName}\n`;
  contentToSummarize += `Description: ${repo.description || "No description"}\n`;
  contentToSummarize += `URL: ${repo.htmlUrl}\n`;
  contentToSummarize += `Language: ${repo.language || "Unknown"}\n`;
  contentToSummarize += `Stars: ${repo.stars}\n`;
  contentToSummarize += `Forks: ${repo.forks}\n`;
  contentToSummarize += `Topics: ${(repo.topics || []).join(", ")}\n`;
  if (readmeContent) contentToSummarize += `\nREADME:\n${readmeContent}`;

  const { systemPrompt, userPrompt } = buildSummarizePrompt(
    contentToSummarize,
    lang,
    repo,
  );

  const summary = await callOpenAI(systemPrompt, userPrompt, apiKey);
  return summary;
}

async function handleWordCloud(request, url, env) {
  try {
    const period = url.searchParams.get("period") || "daily";
    const language = url.searchParams.get("lang") || "";
    const cacheKey = `${period}-${language}`;

    // Check cache first
    const cached = wordcloudCache.get(cacheKey);
    if (cached && Date.now() - cached.time < WORDCLOUD_CACHE_TTL) {
      cacheStats.wordcloudCacheHits++;
      return json({ ...cached.data, isCached: true });
    }

    cacheStats.wordcloudCacheMisses++;

    // Smart strategy: Check if opposite language exists
    const oppositeLang = language === "vi" ? "en" : "en";
    const oppositeCacheKey = `${period}-${oppositeLang}`;
    
    if (wordcloudCache.has(oppositeCacheKey)) {
      // Translate existing wordcloud instead of regenerating
      const existingWordcloud = wordcloudCache.get(oppositeCacheKey);
      const translatedWordcloud = await translateWordCloud(existingWordcloud.data, language, env);
      
      if (translatedWordcloud) {
        wordcloudCache.set(cacheKey, { time: Date.now(), data: translatedWordcloud });
        return json({ ...translatedWordcloud, isTranslated: true, fromLang: oppositeLang });
      }
    }

    // Generate new wordcloud if no translation available
    const repos = await fetchTrendingRepos(period, "", env); // Get all repos for analysis

    // AI Analysis for wordcloud
    const apiKey =
      openAiKeyFromRequest(request) || (env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      // Fallback: Simple keyword extraction without AI
      const wordData = extractBasicKeywords(repos);
      wordcloudCache.set(cacheKey, { time: Date.now(), data: wordData });
      return json({ ...wordData, isGenerated: true });
    }

    // Prepare data for AI analysis
    const repoData = repos.map((repo) => ({
      name: repo.name,
      fullName: repo.fullName,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      starsToday: repo.starsToday,
    }));

    const {systemPrompt, userPrompt} = buildWordcloudPrompt(repoData, period, language);

    // Call AI API using helper function
    const analysis = await callOpenAI(systemPrompt, userPrompt, apiKey);

    // Parse AI response
    let wordData;
    try {
      wordData = safeParseJson(analysis);

      // Validate tối thiểu
      if (!Array.isArray(wordData?.words) || wordData.words.length === 0) {
        throw new Error("Invalid structure: missing words array");
      }

      // Clamp size về [10, 30] phòng model trả sai range
      wordData.words = wordData.words.map((w) => ({
        ...w,
        size: Math.min(30, Math.max(10, Math.round(w.size))),
      }));
    } catch (parseError) {
      console.error(
        "Failed to parse AI response:",
        parseError,
        "\nRaw:",
        analysis?.slice(0, 300),
      );
      wordData = extractBasicKeywords(repos);
    }

    // Cache the result
    wordcloudCache.set(cacheKey, { time: Date.now(), data: wordData });

    return json({ ...wordData, isGenerated: true });
  } catch (error) {
    if (error instanceof AIApiError) {
      return json({ error: error.message, errorCode: error.errorCode }, error.httpStatus);
    }
    if (error instanceof NotFoundError) {
      return json({ error: error.message, errorCode: "not_found" }, 404);
    }
    if (error instanceof RateLimitError) {
      return json({ error: error.message, errorCode: "github_rate_limit" }, 429);
    }
    console.error("WordCloud analysis error:", error);
    return json({ error: "Failed to generate wordcloud analysis", errorCode: "server_error" }, 500);
  }
}

const KNOWN_LANGUAGES = new Set([
  "python",
  "javascript",
  "typescript",
  "rust",
  "go",
  "java",
  "kotlin",
  "swift",
  "c++",
  "c#",
  "ruby",
  "php",
  "scala",
  "elixir",
  "haskell",
  "zig",
  "lua",
  "dart",
]);
const KNOWN_FRAMEWORKS = new Set([
  "react",
  "vue",
  "angular",
  "nextjs",
  "django",
  "flask",
  "fastapi",
  "spring",
  "rails",
  "laravel",
  "express",
  "svelte",
  "nuxt",
  "remix",
  "astro",
  "pytorch",
  "tensorflow",
]);
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "they",
  "have",
  "been",
  "your",
  "code",
  "tool",
  "using",
  "based",
  "make",
  "more",
  "into",
  "than",
  "over",
]);

function extractBasicKeywords(repos) {
  const wordMap = new Map(); // text → { weight, category }
  let langCount = 0,
    fwCount = 0,
    conceptCount = 0;

  repos.forEach((repo) => {
    if (repo.language) {
      const lang = repo.language.toLowerCase();
      const e = wordMap.get(lang) || { weight: 0, category: "language" };
      e.weight += 3;
      wordMap.set(lang, e);
      langCount++;
    }

    const text = (
      (repo.description || "") +
      " " +
      (repo.name || "")
    ).toLowerCase();
    text.split(/[\s\-_/]+/).forEach((raw) => {
      const word = raw.replace(/[^a-z0-9.#+]/g, "");
      if (word.length < 3 || STOPWORDS.has(word)) return;

      const category = KNOWN_LANGUAGES.has(word)
        ? "language"
        : KNOWN_FRAMEWORKS.has(word)
          ? "framework"
          : "concept";

      const e = wordMap.get(word) || { weight: 0, category };
      e.weight += category === "language" ? 2 : 1;
      wordMap.set(word, e);

      if (category === "framework") fwCount++;
      else if (category === "concept") conceptCount++;
    });
  });

  const wordArray = Array.from(wordMap.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 40)
    .map(([text, { weight, category }]) => ({
      text,
      size: Math.min(30, Math.max(10, weight * 2)),
      category,
      repos: Math.ceil(weight / 2),
      weight,
    }));

  const topLangs = wordArray
    .filter((w) => w.category === "language")
    .map((w) => w.text);
  const topFws = wordArray
    .filter((w) => w.category === "framework")
    .map((w) => w.text);
  const topOthers = wordArray
    .filter((w) => w.category === "concept")
    .map((w) => w.text);

  const insights = [
    `${repos.length} repositories analyzed`,
    topLangs.length
      ? `Top languages: ${topLangs.slice(0, 3).join(", ")}`
      : null,
    topFws.length ? `Key frameworks: ${topFws.slice(0, 3).join(", ")}` : null,
    "Add an API key in Settings for AI-powered insights",
  ].filter(Boolean);

  return {
    words: wordArray,
    categories: {
      languages: { count: langCount, totalWeight: langCount * 3 },
      frameworks: { count: fwCount, totalWeight: fwCount * 2 },
      domains: { count: 0, totalWeight: 0 },
      concepts: { count: conceptCount, totalWeight: conceptCount },
    },
    insights,
    trends: {
      emerging: topOthers.slice(0, 4),
      established: topLangs.slice(0, 4),
      rising: topFws.slice(0, 4),
    },
  };
}

// ─── Cache Statistics Module ───────────────────────────────────────────────────
/**
 * Cache monitoring and statistics
 * Track cache sizes, hit rates, and performance metrics
 */

const cacheStats = {
  listCacheHits: 0,
  listCacheMisses: 0,
  summaryCacheHits: 0,
  summaryCacheMisses: 0,
  repoCacheHits: 0,
  repoCacheMisses: 0,
  wordcloudCacheHits: 0,
  wordcloudCacheMisses: 0,
};

function getCacheStats() {
  return {
    listIdCaches: {
      size: listIdCaches.size,
      hits: cacheStats.listCacheHits,
      misses: cacheStats.listCacheMisses,
      hitRate: cacheStats.listCacheHits + cacheStats.listCacheMisses > 0 
        ? (cacheStats.listCacheHits / (cacheStats.listCacheHits + cacheStats.listCacheMisses) * 100).toFixed(1)
        : 0,
      ttl: LIST_CACHE_TTL
    },
    summaryCache: {
      size: summaryCache.size,
      hits: cacheStats.summaryCacheHits,
      misses: cacheStats.summaryCacheMisses,
      hitRate: cacheStats.summaryCacheHits + cacheStats.summaryCacheMisses > 0 
        ? (cacheStats.summaryCacheHits / (cacheStats.summaryCacheHits + cacheStats.summaryCacheMisses) * 100).toFixed(1)
        : 0,
      maxEntries: SUMMARY_CACHE_MAX
    },
    repoCache: {
      size: repoCache.size,
      hits: cacheStats.repoCacheHits,
      misses: cacheStats.repoCacheMisses,
      hitRate: cacheStats.repoCacheHits + cacheStats.repoCacheMisses > 0 
        ? (cacheStats.repoCacheHits / (cacheStats.repoCacheHits + cacheStats.repoCacheMisses) * 100).toFixed(1)
        : 0,
      maxEntries: REPO_CACHE_MAX
    },
    wordcloudCache: {
      size: wordcloudCache.size,
      hits: cacheStats.wordcloudCacheHits,
      misses: cacheStats.wordcloudCacheMisses,
      hitRate: cacheStats.wordcloudCacheHits + cacheStats.wordcloudCacheMisses > 0 
        ? (cacheStats.wordcloudCacheHits / (cacheStats.wordcloudCacheHits + cacheStats.wordcloudCacheMisses) * 100).toFixed(1)
        : 0,
      ttl: WORDCLOUD_CACHE_TTL,
      maxEntries: WORDCLOUD_CACHE_MAX
    }
  };
}

function clearAllCaches() {
  listIdCaches.clear();
  summaryCache.clear();
  repoCache.clear();
  wordcloudCache.clear();
  
  // Reset stats
  Object.keys(cacheStats).forEach(key => {
    cacheStats[key] = 0;
  });
  
  return { success: true, message: "All caches cleared" };
}

function clearCacheType(type) {
  switch(type) {
    case 'listIdCaches':
      listIdCaches.clear();
      cacheStats.listCacheHits = 0;
      cacheStats.listCacheMisses = 0;
      return { success: true, message: "List cache cleared" };
    case 'summaryCache':
      summaryCache.clear();
      cacheStats.summaryCacheHits = 0;
      cacheStats.summaryCacheMisses = 0;
      return { success: true, message: "Summary cache cleared" };
    case 'repoCache':
      repoCache.clear();
      cacheStats.repoCacheHits = 0;
      cacheStats.repoCacheMisses = 0;
      return { success: true, message: "Repository cache cleared" };
    case 'wordcloudCache':
      wordcloudCache.clear();
      cacheStats.wordcloudCacheHits = 0;
      cacheStats.wordcloudCacheMisses = 0;
      return { success: true, message: "WordCloud cache cleared" };
    default:
      return { success: false, message: "Unknown cache type" };
  }
}

// ─── Main Export Module ───────────────────────────────────────────────────────
/**
 * Main Cloudflare Worker export
 * Route handling and request dispatch
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);

    // Route handling
    try {
      if (url.pathname === "/api/repos") {
        return await handleRepos(request, url, env);
      }

      if (url.pathname === "/api/repo") {
        return await handleRepoDetails(request, url, env);
      }

      if (url.pathname === "/api/issues") {
        return handleGitHubIssues(request, url, env);
      }

      if (url.pathname === "/api/summarize") {
        return await handleSummarize(request, url, env);
      }

      if (url.pathname === "/api/wordcloud") {
        return await handleWordCloud(request, url, env);
      }

      // Admin endpoints
      if (url.pathname === "/api/admin/stats") {
        if (request.method === "GET") {
          return json(getCacheStats());
        }
        return json({ error: "Method not allowed" }, 405);
      }

      if (url.pathname === "/api/admin/clear") {
        if (request.method === "POST") {
          try {
            const body = await request.json().catch(() => ({}));
            const cacheType = body.type;
            
            if (cacheType) {
              return json(clearCacheType(cacheType));
            } else {
              return json(clearAllCaches());
            }
          } catch (error) {
            return json({ error: "Invalid request" }, 400);
          }
        }
        return json({ error: "Method not allowed" }, 405);
      }

      if (url.pathname === "/admin") {
        return env.ASSETS.fetch(request);
      }

      // Serve static assets
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return env.ASSETS.fetch(request);
      }

      if (url.pathname.startsWith("/")) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
};
