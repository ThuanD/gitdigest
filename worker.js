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

// ─── Custom exception ──────────────────────────────────────────────
class RateLimitError extends Error {}
class NotFoundError extends Error {}
class AICallError extends Error {}
class AIResponseError extends Error {}
class AINoContentError extends Error {}

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
  }

  return repos;
}

async function fetchGitHubRepo(repoId, env) {
  try {
    const cached = repoCache.get(repoId);

    if (cached && Date.now() - cached.time < LIST_CACHE_TTL) {
      return { repo: cached.repo, isCached: true };
    }

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
    console.error("AI API request failed:", aiData);
    throw new Error(`AI API request failed: ${response.status}`);
  }

  if (aiData.error) throw new Error(aiData.error.message || "API error");

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
      return json({ error: "Missing repository ID" }, 400);
    }

    const lang = (url.searchParams.get("lang") || "en").slice(0, 12);

    const cacheKey = `${repoId}_${lang}`;
    if (summaryCache.has(cacheKey)) {
      return json({ summary: summaryCache.get(cacheKey), isCached: true });
    }

    const apiKey =
      openAiKeyFromRequest(request) || (env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return json({ error: "Missing API key." }, 401);
    }

    const { repo, _ } = await fetchGitHubRepo(repoId, env);

    // Fetch and render README using the new function (with AI processing)
    const { readmeContent, _readmeHtml } = await fetchAndRenderReadme(
      repo,
      env,
      true,
    );

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

    summaryCacheSet(cacheKey, summary);
    return json({ summary, cached: false });
  } catch (error) {
    if (error instanceof NotFoundError)
      return json({ error: error.message }, 404);
    if (error instanceof RateLimitError)
      return json({ error: error.message }, 429);
    if (error instanceof AICallError)
      return json({ error: error.message }, 400);
    if (error instanceof AIResponseError)
      return json({ error: error.message }, 400);
    if (error instanceof AINoContentError)
      return json({ error: error.message }, 400);

    console.error("Summarize error:", error);
    return json({ error: "Failed to generate summary" }, 500);
  }
}

async function handleWordCloud(request, url, env) {
  try {
    const period = url.searchParams.get("period") || "daily";
    const language = url.searchParams.get("lang") || "";
    const cacheKey = `${period}-${language}`;

    // Check cache first
    const cached = wordcloudCache.get(cacheKey);
    if (cached && Date.now() - cached.time < WORDCLOUD_CACHE_TTL) {
      return json({ ...cached.data, isCached: true });
    }

    const repos = await fetchTrendingRepos(period, language, env);

    // AI Analysis for wordcloud
    const apiKey =
      openAiKeyFromRequest(request) || (env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      // Fallback: Simple keyword extraction without AI
      const wordData = extractBasicKeywords(repos);
      wordcloudCacheSet(cacheKey, wordData);
      return json(wordData);
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
    wordcloudCacheSet(cacheKey, wordData);

    return json({ ...wordData, cached: false });
  } catch (error) {
    if (error instanceof NotFoundError)
      return json({ error: error.message }, 404);
    if (error instanceof RateLimitError)
      return json({ error: error.message }, 429);
    if (error instanceof AICallError)
      return json({ error: error.message }, 400);
    if (error instanceof AIResponseError)
      return json({ error: error.message }, 400);
    if (error instanceof AINoContentError)
      return json({ error: error.message }, 400);

    console.error("WordCloud analysis error:", error);
    return json({ error: "Failed to generate wordcloud analysis" }, 500);
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
