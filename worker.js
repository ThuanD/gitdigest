const LIST_CACHE_TTL = 30 * 60 * 1000;
const SUMMARY_CACHE_MAX = 500; // max entries (was mistakenly set to TTL ms)
const REPO_CACHE_MAX = 200; // max entries (was mistakenly set to TTL ms)
const WORDCLOUD_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const WORDCLOUD_CACHE_MAX = 100; // max entries

const listIdCaches = new Map(); // key: "period-language" — was plain object, lookup never matched
const summaryCache = new Map();
const repoCache = new Map();
const wordcloudCache = new Map();

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

async function handleStories(url) {
  try {
    const period = url.searchParams.get("period") || "daily";
    const language = url.searchParams.get("lang") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = 15;

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

      if (!res.ok)
        throw new Error(`GitHub trending fetch failed: ${res.status}`);

      repos = await parseTrendingPage(res);
      listIdCaches.set(cacheKey, { time: Date.now(), repos });
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
        current._todayRaw = (current._todayRaw || "") + chunk.text;
      },
    });

  await rewriter.transform(response).arrayBuffer();

  return repos.map((repo) => {
    const parseNum = (str = "") =>
      parseInt((str || "").replace(/,/g, "").trim(), 10) || 0;

    const starsToday = parseNum(
      (repo._todayRaw || "").replace(/stars today/i, "").trim(),
    );
    const forks = parseNum(repo._forksRaw);

    return {
      id: repo.fullName,
      title: repo.fullName,
      name: repo.name,
      owner: repo.owner,
      description: repo.description.trim(),
      language: repo.language.trim(),
      stars: parseNum(repo._starsRaw),
      forks,
      starsToday,
      url: repo.url,
      by: repo.owner,
      score: starsToday,
    };
  });
}

function resolveMediaUrls(html, fullName, defaultBranch = 'main') {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;
  return html
    // Handle <img> tags with double quotes
    .replace(
      /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<img${before} src="${base}/${cleanSrc}"${after}>`;
      }
    )
    // Handle <img> tags with single quotes
    .replace(
      /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<img${before} src='${base}/${cleanSrc}'${after}>`;
      }
    )
    // Handle <video> tags with double quotes
    .replace(
      /<video([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<video${before} src="${base}/${cleanSrc}"${after}>`;
      }
    )
    // Handle <video> tags with single quotes
    .replace(
      /<video([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<video${before} src='${base}/${cleanSrc}'${after}>`;
      }
    )
    // Handle <source> tags inside <video> with double quotes
    .replace(
      /<source([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<source${before} src="${base}/${cleanSrc}"${after}>`;
      }
    )
    // Handle <source> tags inside <video> with single quotes
    .replace(
      /<source([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, before, src, after) => {
        const cleanSrc = src.replace(/^\.\//, "");
        return `<source${before} src='${base}/${cleanSrc}'${after}>`;
      }
    );
}

async function renderGitHubMarkdown(content, fullName, env) {
  try {
    const renderRes = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Trending-Digest-Worker",
        ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
      },
      body: JSON.stringify({
        text: content,
        mode: "gfm",
        context: fullName
      }),
    });
    
    if (renderRes.ok) {
      const html = await renderRes.text();
      return html; // Will be processed by resolveMediaUrls
    }
    return null;
  } catch (error) {
    console.log("GitHub markdown render failed:", error.message);
    return null;
  }
}

async function fetchAndRenderReadme(repo, env, forAI = false) {
  let readmeContent = "";
  let readmeHtml = "";
  
  try {
    // Fetch README content
    const readmeRes = await fetch(
      `https://api.github.com/repos/${repo.full_name}/readme`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Github-Trending-Digest-Worker",
          ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
        },
      },
    );
    
    if (readmeRes.ok) {
      const readmeData = await readmeRes.json();
      readmeContent = atob(readmeData.content);
      
      // Render to HTML using GitHub's API
      readmeHtml = await renderGitHubMarkdown(readmeContent, repo.full_name, env);
      
      // Resolve media URLs if HTML was rendered
      if (readmeHtml) {
        readmeHtml = resolveMediaUrls(readmeHtml, repo.full_name, repo.default_branch);
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
    console.log("README fetch failed:", readmeError.message);
  }
  
  return { readmeContent, readmeHtml };
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
    return json({ summary: summaryCache.get(cacheKey), cached: true });
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
    const repoUrl = repoId.includes("/")
      ? `https://api.github.com/repos/${repoId}`
      : `https://api.github.com/repositories/${repoId}`;

    const repoRes = await fetch(repoUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Trending-Digest-Worker",
      },
    });

    if (!repoRes.ok) throw new Error(`GitHub API error: ${repoRes.status}`);

    const repo = await repoRes.json();

    // Fetch and render README using the new function (with AI processing)
    const { readmeContent, readmeHtml } = await fetchAndRenderReadme(repo, env, true);

    let contentToSummarize = `Repository: ${repo.full_name}\n`;
    contentToSummarize += `Description: ${repo.description || "No description"}\n`;
    contentToSummarize += `Language: ${repo.language || "Unknown"}\n`;
    contentToSummarize += `Stars: ${repo.stargazers_count}\n`;
    contentToSummarize += `Forks: ${repo.forks_count}\n`;
    contentToSummarize += `Topics: ${(repo.topics || []).join(", ")}\n`;
    if (readmeContent) contentToSummarize += `\nREADME:\n${readmeContent}`;

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
      // Gemini — fixed model name (was "gemini-3-flash-preview" which doesn't exist)
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      requestBody = {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: 4096 },
      };
    }

    const headers = { "Content-Type": "application/json" };
    if (!apiKey.startsWith("AIza")) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const aiRes = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message || "API error");

    const summary = apiKey.startsWith("AIza")
      ? aiData.candidates?.[0]?.content?.parts?.[0]?.text
      : aiData.choices?.[0]?.message?.content;

    if (!summary) throw new Error("No content received from API");

    summaryCacheSet(cacheKey, summary);
    return json({ summary, cached: false });
  } catch (error) {
    console.error("summarize:", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate summary.",
      },
      500,
    );
  }
}

async function handleRepoDetails(url, env) {
  const repoId = url.searchParams.get("id");
  if (!repoId) return json({ error: "Missing repository ID" }, 400);

  const cached = repoCache.get(repoId);
  if (cached && Date.now() - cached.t < LIST_CACHE_TTL) {
    return json({ ...cached.result, cached: true });
  }

  try {
    const repoUrl = repoId.includes("/")
      ? `https://api.github.com/repos/${repoId}`
      : `https://api.github.com/repositories/${repoId}`;

    const ghHeaders = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Github-Trending-Digest-Worker",
      ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
    };

    const [repoRes, readmeRes] = await Promise.all([
      fetch(repoUrl, { headers: ghHeaders }),
      fetch(`${repoUrl}/readme`, { headers: ghHeaders }).catch(() => null),
    ]);

    if (!repoRes.ok) {
      if (repoRes.status === 403) {
        const errorData = await repoRes.json().catch(() => ({}));
        if (errorData.message?.includes("rate limit")) {
          return json(
            {
              error: "GitHub API rate limit exceeded. Please try again later.",
            },
            429,
          );
        }
      }
      throw new Error(`GitHub API error: ${repoRes.status}`);
    }

    const repo = await repoRes.json();
    
    // Fetch and render README using the new function
    const { readmeContent, readmeHtml } = await fetchAndRenderReadme(repo, env);

    const result = {
      ...mapGitHubRepo(repo),
      readme_content: readmeContent,
      readme_html: readmeHtml,
      raw_api_response: repo,
    };

    repoCacheSet(repoId, { t: Date.now(), result });
    return json(result);
  } catch (error) {
    console.error("Repo details fetch error:", error);
    return json({ error: "Failed to fetch repository details" }, 500);
  }
}

async function handleGitHubIssues(url, env) {
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  if (!owner || !repo)
    return json({ error: "Missing owner or repo parameters" }, 400);

  try {
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=25`;
    const response = await fetch(issuesUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Github-Trending-Digest-Worker",
        ...(env.GITHUB_TOKEN && { Authorization: `token ${env.GITHUB_TOKEN}` }),
      },
    });

    if (!response.ok) {
      if (response.status === 404)
        return json({ error: "Repository not found or no issues" }, 404);
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issues = await response.json();
    return json({
      issues,
      repo_url: `https://github.com/${owner}/${repo}`,
      count: issues.length,
    });
  } catch (error) {
    console.error("GitHub Issues fetch error:", error);
    return json({ error: "Failed to fetch issues" }, 500);
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
      return json({ ...cached.data, cached: true });
    }

    // Get trending stories (reuse existing logic)
    const sinceMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
    const since = sinceMap[period] || "daily";

    const trendingUrl = `https://github.com/trending/${encodeURIComponent(language)}?since=${since}`;

    const res = await fetch(trendingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TrendingBot/1.0)",
        Accept: "text/html",
      },
    });

    if (!res.ok) throw new Error(`GitHub trending fetch failed: ${res.status}`);

    const stories = await parseTrendingPage(res);

    // AI Analysis for wordcloud
    const apiKey =
      openAiKeyFromRequest(request) || (env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      // Fallback: Simple keyword extraction without AI
      const wordData = extractBasicKeywords(stories);
      wordcloudCacheSet(cacheKey, wordData);
      return json(wordData);
    }

    // Prepare data for AI analysis
    const repoData = stories.map((repo) => ({
      name: repo.name,
      fullName: repo.fullName,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      starsToday: repo.starsToday,
    }));

    const systemPrompt = `You are a trend analysis expert specializing in GitHub repositories and technology trends.

Analyze the provided GitHub trending repositories and extract meaningful technology trends for a word cloud visualization.

Requirements:
1. Extract technical keywords, programming languages, frameworks, and concepts
2. Group related terms (e.g., "ai", "ml", "machine-learning" → "AI/ML")
3. Filter out common words and focus on technical terms
4. Weight terms by frequency, popularity (stars), and trend significance
5. Categorize terms: languages, frameworks, domains, concepts
6. Provide insights about emerging vs established trends

Return JSON format:
{
  "words": [
    {"text": "javascript", "size": 25, "category": "language", "repos": 8, "weight": 15},
    {"text": "react", "size": 20, "category": "framework", "repos": 6, "weight": 12},
    {"text": "ai/ml", "size": 18, "category": "domain", "repos": 5, "weight": 10}
  ],
  "categories": {
    "languages": {"count": 5, "totalWeight": 45},
    "frameworks": {"count": 8, "totalWeight": 38},
    "domains": {"count": 4, "totalWeight": 25},
    "concepts": {"count": 6, "totalWeight": 20}
  },
  "insights": [
    "AI/ML projects dominate with 40% of trending repos",
    "JavaScript ecosystem remains strong with React and Node.js",
    "Rust gaining traction in systems programming"
  ],
  "trends": {
    "emerging": ["rust", "webassembly", "blockchain"],
    "established": ["javascript", "python", "react"],
    "rising": ["ai/ml", "devops", "microservices"]
  }
}

Constraints:
- Maximum 50 words total
- Minimum word length: 3 characters
- Size range: 10-30 (based on weight)
- Focus on actionable, technical insights`;

    const userPrompt = `Analyze these GitHub trending repositories and extract technology trends:\n\n${JSON.stringify(repoData, null, 2)}`;

    // Call AI API
    let apiUrl, requestBody;

    if (apiKey.startsWith("gsk_")) {
      apiUrl = "https://api.groq.com/openai/v1/chat/completions";
      requestBody = {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      };
    } else if (apiKey.startsWith("sk-")) {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      requestBody = {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      };
    } else {
      // Gemini
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      requestBody = {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      };
    }

    const headers = { "Content-Type": "application/json" };
    if (!apiKey.startsWith("AIza")) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const aiRes = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const aiData = await aiRes.json();
    if (aiData.error)
      throw new Error(aiData.error.message || "AI analysis failed");

    const analysis = apiKey.startsWith("AIza")
      ? aiData.candidates?.[0]?.content?.parts?.[0]?.text
      : aiData.choices?.[0]?.message?.content;

    if (!analysis) throw new Error("No analysis received from AI");

    // Parse AI response
    let wordData;
    try {
      wordData = JSON.parse(analysis);
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      wordData = extractBasicKeywords(stories);
    }

    // Cache the result
    wordcloudCacheSet(cacheKey, wordData);

    return json({ ...wordData, cached: false });
  } catch (error) {
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

function extractBasicKeywords(stories) {
  const wordMap = new Map(); // text → { weight, category }
  let langCount = 0,
    fwCount = 0,
    conceptCount = 0;

  stories.forEach((story) => {
    if (story.language) {
      const lang = story.language.toLowerCase();
      const e = wordMap.get(lang) || { weight: 0, category: "language" };
      e.weight += 3;
      wordMap.set(lang, e);
      langCount++;
    }

    const text = (
      (story.description || "") +
      " " +
      (story.name || "")
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
    `${stories.length} repositories analyzed`,
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/api/stories") return handleStories(url);
    if (path === "/api/repo") return handleRepoDetails(url, env);
    if (path === "/api/issues") return handleGitHubIssues(url, env);
    if (path === "/api/summarize") return handleSummarize(request, url, env);
    if (path === "/api/wordcloud") return handleWordCloud(request, url, env);

    return env.ASSETS.fetch(request);
  },
};
