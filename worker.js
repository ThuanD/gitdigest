const LIST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - avoid GitHub rate limits
const SUMMARY_CACHE_MAX = 400;
const EMBED_CHECK_CACHE_MAX = 600;

const listIdCaches = {
  daily: { time: 0, repos: [] },
  weekly: { time: 0, repos: [] },
  monthly: { time: 0, repos: [] },
};
const summaryCache = new Map();
/** @type {Map<string, { t: number, result: { embeddable: boolean, reason: string | null } }>} */
const embedCheckCache = new Map();

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

/** Merge duplicate Content-Security-Policy header values from the response. */
function combinedCspHeader(headers) {
  const parts = [];
  for (const [k, v] of headers) {
    if (k.toLowerCase() === "content-security-policy") parts.push(v);
  }
  return parts.length
    ? parts.join("; ")
    : headers.get("Content-Security-Policy") || "";
}

function extractFrameAncestors(cspValue) {
  if (!cspValue) return "";
  for (const piece of cspValue.split(";")) {
    const s = piece.trim();
    if (/^frame-ancestors\s/i.test(s)) {
      return s.replace(/^frame-ancestors\s+/i, "").trim();
    }
  }
  return "";
}

/**
 * Best-effort from response headers only. False negatives/positives are possible.
 * `parentOrigin` should be the embedding page origin (e.g. https://your-app.pages.dev).
 */
function embeddableFromHeaders(headers, parentOrigin) {
  const xfo = (headers.get("X-Frame-Options") || "").trim().toUpperCase();
  if (xfo === "DENY" || xfo === "SAMEORIGIN") {
    return { embeddable: false, reason: "x_frame_options" };
  }

  const csp = combinedCspHeader(headers);
  const faRaw = extractFrameAncestors(csp);
  if (!faRaw) {
    return { embeddable: true, reason: null };
  }

  if (/\b'none'\b/i.test(faRaw)) {
    return { embeddable: false, reason: "csp_frame_ancestors" };
  }
  if (/^\s*'self'\s*$/i.test(faRaw)) {
    return { embeddable: false, reason: "csp_frame_ancestors" };
  }

  let parent = "";
  try {
    if (parentOrigin) parent = new URL(parentOrigin).origin;
  } catch {
    parent = "";
  }

  if (parent) {
    const tokens = faRaw.match(/(?:'[^']*'|[^\s']+)/g) || [];
    let allowed = false;
    for (const raw of tokens) {
      const t =
        raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
      if (t === "*") {
        allowed = true;
        break;
      }
      if (t.toLowerCase() === "self") continue;
      try {
        const u = new URL(t);
        if (u.origin === parent) {
          allowed = true;
          break;
        }
      } catch {
        /* ignore malformed token */
      }
    }
    if (!allowed) {
      return { embeddable: false, reason: "csp_frame_ancestors" };
    }
  }

  return { embeddable: true, reason: null };
}

async function handleEmbedCheck(url) {
  const target = url.searchParams.get("url");
  const parentOrigin = (url.searchParams.get("parent") || "").trim();
  if (!target || !isPublicHttpUrlForFetch(target)) {
    return json({ embeddable: false, error: "invalid_url" }, 400);
  }

  let canonical;
  try {
    canonical = new URL(target).href;
  } catch {
    return json({ embeddable: false, error: "invalid_url" }, 400);
  }

  const cacheKey = `${canonical}\0${parentOrigin}`;
  const hit = embedCheckCache.get(cacheKey);
  if (hit && Date.now() - hit.t < LIST_CACHE_TTL) {
    return json({ ...hit.result, cached: true });
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 7000);
  try {
    let res = await fetch(canonical, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(canonical, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { Range: "bytes=0-0" },
      });
    }
    const result = embeddableFromHeaders(res.headers, parentOrigin);
    try {
      if (res.body?.cancel) await res.body.cancel();
    } catch {
      /* ignore */
    }
    embedCheckCacheSet(cacheKey, { t: Date.now(), result });
    return json({ ...result, cached: false });
  } catch {
    return json({ embeddable: true, reason: "check_failed" });
  } finally {
    clearTimeout(t);
  }
}

/** Block obvious SSRF targets when fetching arbitrary story URLs. */
function isPublicHttpUrlForFetch(urlString) {
  try {
    const u = new URL(urlString);
    if (u.username || u.password) return false;
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    ) {
      return false;
    }
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4.test(host)) {
      const p = host.split(".").map((x) => parseInt(x, 10));
      if (p.some((n) => n > 255)) return false;
      if (p[0] === 10) return false;
      if (p[0] === 127) return false;
      if (p[0] === 0) return false;
      if (p[0] === 192 && p[1] === 168) return false;
      if (p[0] === 169 && p[1] === 254) return false;
      if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;
      if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function summaryCacheSet(key, value) {
  if (summaryCache.size >= SUMMARY_CACHE_MAX && !summaryCache.has(key)) {
    const first = summaryCache.keys().next().value;
    summaryCache.delete(first);
  }
  summaryCache.set(key, value);
}

function embedCheckCacheSet(key, entry) {
  if (
    embedCheckCache.size >= EMBED_CHECK_CACHE_MAX &&
    !embedCheckCache.has(key)
  ) {
    const first = embedCheckCache.keys().next().value;
    embedCheckCache.delete(first);
  }
  embedCheckCache.set(key, entry);
}

async function handleStories(url) {
  try {
    const period = url.searchParams.get("period") || "daily"; // daily, weekly, monthly
    const language = url.searchParams.get("lang") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = 15;

    // Map period to GitHub trending params
    const sinceMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
    const since = sinceMap[period] || "daily";

    const cacheKey = `${period}-${language}`;
    let cache = listIdCaches[cacheKey];

    let repos = cache?.repos;

    if (
      !repos ||
      repos.length === 0 ||
      Date.now() - cache.time > LIST_CACHE_TTL
    ) {
      // Scrape GitHub trending page directly
      const trendingUrl = `https://github.com/trending/${encodeURIComponent(language)}?since=${since}`;

      const res = await fetch(trendingUrl, {
        headers: {
          // Required headers to avoid 429 errors
          "User-Agent": "Mozilla/5.0 (compatible; TrendingBot/1.0)",
          Accept: "text/html",
        },
      });

      if (!res.ok)
        throw new Error(`GitHub trending fetch failed: ${res.status}`);

      repos = await parseTrendingPage(res);

      listIdCaches[cacheKey] = { time: Date.now(), repos };
    }

    const startIndex = (page - 1) * limit;
    const pageRepos = repos.slice(startIndex, startIndex + limit);

    return json({
      stories: pageRepos,
      hasMore: startIndex + limit < repos.length,
      feed: period,
    });
  } catch (error) {
    console.error("Trending fetch error:", error);
    return json({ error: "Failed to fetch trending repositories" }, 500);
  }
}

async function parseTrendingPage(response) {
  const repos = [];
  let current = null;

  // HTMLRewriter stream-parse HTML without DOM
  const rewriter = new HTMLRewriter()
    .on("article.Box-row", {
      element() {
        current = {
          name: "",
          fullName: "",
          description: "",
          language: "",
          stars: 0,
          forks: 0,
          starsToday: 0,
          url: "",
          avatar: "",
        };
        repos.push(current);
      },
    })
    .on("article.Box-row h2 a", {
      element(el) {
        if (!current) return;
        const href = el.getAttribute("href") || "";
        // href format: "/owner/repo"
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
        current._todayRaw = (current._todayRaw || "") + chunk.text;
      },
    });

  // Must consume entire response body
  await rewriter.transform(response).arrayBuffer();

  // Clean up text fields
  return repos.map((repo) => {
    const parseNum = (str = "") =>
      parseInt((str || "").replace(/,/g, "").trim(), 10) || 0;

    const starsToday = parseNum(
      (repo._todayRaw || "").replace(/stars today/i, "").trim(),
    );

    return {
      id: repo.fullName,
      title: repo.fullName,
      name: repo.name,
      owner: repo.owner,
      description: repo.description.trim(),
      language: repo.language.trim(),
      stars: parseNum(repo._starsRaw),
      forks: parseNum(repo._forksRaw),
      starsToday,
      url: repo.url,
      by: repo.owner,
      score: starsToday,
    };
  });
}

function getDateQuery(period) {
  const now = new Date();
  if (period === "daily") {
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    return `>${twoDaysAgo.toISOString().split("T")[0]}`;
  } else if (period === "weekly") {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return `>${weekAgo.toISOString().split("T")[0]}`;
  } else {
    // monthly
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return `>${monthAgo.toISOString().split("T")[0]}`;
  }
}

function mapGitHubRepo(repo) {
  return {
    id: repo.id,
    title: repo.full_name,
    url: repo.html_url,
    score: repo.stargazers_count,
    by: repo.owner.login,
    time: Math.floor(new Date(repo.created_at).getTime() / 1000),
    description: repo.description,
    language: repo.language,
    topics: repo.topics || [],
    forks: repo.forks_count,
    readme_url: `${repo.html_url}/blob/main/README.md`,
    repo_url: repo.html_url,
    api_url: repo.url,
    owner_avatar: repo.owner.avatar_url,
  };
}

async function handleSummarize(request, url, env) {
  const repoId = url.searchParams.get("id");
  const lang = (url.searchParams.get("lang") || "en").slice(0, 12);

  if (!repoId) {
    return json({ error: "Missing repository ID" }, 400);
  }

  const cacheKey = `${repoId}_${lang}`;
  if (summaryCache.has(cacheKey)) {
    return json({
      summary: summaryCache.get(cacheKey),
      cached: true,
    });
  }

  const apiKey =
    openAiKeyFromRequest(request) || (env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return json(
      {
        error:
          "Missing API key. Add your OpenAI (sk-), Groq (gsk_), or Gemini (AIza...) API key in settings or set OPENAI_API_KEY as a Worker secret.",
      },
      401,
    );
  }

  try {
    // Check if repoId is in "owner/repo" format or numeric ID
    let repoUrl;
    if (repoId.includes("/")) {
      repoUrl = `https://api.github.com/repos/${repoId}`;
    } else {
      repoUrl = `https://api.github.com/repositories/${repoId}`;
    }

    // Fetch repository details from GitHub API
    const repoRes = await fetch(repoUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Trending-Digest-Worker",
      },
    });

    if (!repoRes.ok) {
      throw new Error(`GitHub API error: ${repoRes.status}`);
    }

    const repo = await repoRes.json();

    // Try to fetch README content
    let readmeContent = "";
    try {
      const readmeRes = await fetch(
        `https://api.github.com/repos/${repo.full_name}/readme`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Github-Trending-Digest-Worker",
          },
        },
      );

      if (readmeRes.ok) {
        const readmeData = await readmeRes.json();
        // GitHub returns base64 encoded content
        readmeContent = atob(readmeData.content);
        // Clean up markdown
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
    } catch (readmeError) {
      console.log("README fetch failed:", readmeError.message);
    }

    let contentToSummarize = `Repository: ${repo.full_name}\n`;
    contentToSummarize += `Description: ${repo.description || "No description"}\n`;
    contentToSummarize += `Language: ${repo.language || "Unknown"}\n`;
    contentToSummarize += `Stars: ${repo.stargazers_count}\n`;
    contentToSummarize += `Forks: ${repo.forks_count}\n`;
    contentToSummarize += `Topics: ${(repo.topics || []).join(", ")}\n`;

    if (readmeContent) {
      contentToSummarize += `\nREADME:\n${readmeContent}`;
    }

    const systemPrompt = `You are an expert technical summarizer specializing in GitHub repositories and open source projects.

Output requirements:
- Write in the language for ISO code '${lang}' for the entire answer (headings, bullets, and prose).
- Focus on: What the project does, its key features, technical stack, and why it's notable.
- Highlight: Programming language, architecture patterns, dependencies, and use cases.
- Use clear Markdown: **bold** for emphasis, bullet lists where helpful, short subheadings (##) to organize answers.
- Include: Star count context, recent activity indicators, and community engagement.
- If README is sparse, provide educated context about the technology stack and typical use cases.
- Target 400-700 words for comprehensive coverage.`;

    const userPrompt = `Analyze and summarize this GitHub repository for developers. Explain what the project does, its technical implementation, key features, and why it's gaining traction.\n\n${contentToSummarize}`;

    // Determine API provider based on key format
    let apiUrl, model, requestBody, errorMessage;

    if (apiKey.startsWith("gsk_")) {
      // Groq API (OpenAI-compatible)
      apiUrl = "https://api.groq.com/openai/v1/chat/completions";
      model = "llama-3.3-70b-versatile";
      requestBody = {
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 4096,
      };
      errorMessage =
        "Missing Groq API key. Add your key in settings or set OPENAI_API_KEY as a Worker secret.";
    } else if (apiKey.startsWith("sk-")) {
      // OpenAI API
      apiUrl = "https://api.openai.com/v1/chat/completions";
      model = "gpt-4o-mini";
      requestBody = {
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 4096,
      };
      errorMessage =
        "Missing OpenAI API key. Add your key in settings or set OPENAI_API_KEY as a Worker secret.";
    } else {
      // Gemini API (different format)
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      requestBody = {
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.45,
          maxOutputTokens: 4096,
        },
      };
      errorMessage =
        "Missing Gemini API key. Add your key in settings or set OPENAI_API_KEY as a Worker secret.";
    }

    const headers = {
      "Content-Type": "application/json",
    };

    // Gemini uses different auth (key in URL)
    if (!apiKey.startsWith("AIza")) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const aiRes = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    const aiData = await aiRes.json();
    if (aiData.error) {
      throw new Error(aiData.error.message || "API error");
    }

    let summary;
    if (apiKey.startsWith("AIza")) {
      // Gemini response format
      summary = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      // OpenAI/Groq response format
      summary = aiData.choices?.[0]?.message?.content;
    }

    if (!summary) {
      throw new Error("No content received from API");
    }
    summaryCacheSet(cacheKey, summary);

    return json({ summary, cached: false });
  } catch (error) {
    console.error("summarize:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate summary.";
    return json({ error: message }, 500);
  }
}

async function handleRepoDetails(url) {
  const repoId = url.searchParams.get("id");

  if (!repoId) {
    return json({ error: "Missing repository ID" }, 400);
  }

  try {
    // Check if repoId is in "owner/repo" format or numeric ID
    let repoUrl;
    if (repoId.includes("/")) {
      repoUrl = `https://api.github.com/repos/${repoId}`;
    } else {
      repoUrl = `https://api.github.com/repositories/${repoId}`;
    }

    const [repoRes, readmeRes] = await Promise.all([
      fetch(repoUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Github-Trending-Digest-Worker",
        },
      }),
      fetch(`${repoUrl}/readme`, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Github-Trending-Digest-Worker",
        },
      }).catch(() => null),
    ]);

    if (!repoRes.ok) {
      throw new Error(`GitHub API error: ${repoRes.status}`);
    }

    const repo = await repoRes.json();
    let readmeContent = "";

    if (readmeRes && readmeRes.ok) {
      const readmeData = await readmeRes.json();
      readmeContent = atob(readmeData.content);
    }

    return json({
      ...mapGitHubRepo(repo),
      readme_content: readmeContent,
      raw_api_response: repo,
    });
  } catch (error) {
    console.error("Repo details fetch error:", error);
    return json({ error: "Failed to fetch repository details" }, 500);
  }
}

async function handleGitHubIssues(url) {
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");

  if (!owner || !repo) {
    return json({ error: "Missing owner or repo parameters" }, 400);
  }

  try {
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=25`;

    const response = await fetch(issuesUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Trending-Digest-Worker",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return json({ error: "Repository not found or no issues" }, 404);
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issues = await response.json();

    return json({
      issues: issues,
      repo_url: `https://github.com/${owner}/${repo}`,
      count: issues.length,
    });
  } catch (error) {
    console.error("GitHub Issues fetch error:", error);
    return json({ error: "Failed to fetch issues" }, 500);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/api/stories") {
      return handleStories(url);
    }
    if (path === "/api/repo") {
      return handleRepoDetails(url);
    }
    if (path === "/api/issues") {
      return handleGitHubIssues(url);
    }
    if (path === "/api/summarize") {
      return handleSummarize(request, url, env);
    }
    if (path === "/api/embed-check") {
      return handleEmbedCheck(url);
    }

    return env.ASSETS.fetch(request);
  },
};
