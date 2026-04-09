import type { Env, GitHubRepo, TrendingRepo } from "./types";
import { NotFoundError, RateLimitError } from "./errors";
import { TTLCache, LRUCache } from "./cache";

// ─── Cache Instances ─────────────────────────────────────────────────────────

const LIST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const trendingCache = new TTLCache<TrendingRepo[]>(50, LIST_CACHE_TTL);
export const repoCache = new TTLCache<GitHubRepo>(200, LIST_CACHE_TTL);

// ─── Raw HTML Parsing ─────────────────────────────────────────────────────────

interface RawRepoScrape {
  fullName: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  language: string;
  _starsRaw: string;
  _forksRaw: string;
  _todayRaw: string;
}

function parseNum(str = ""): number {
  return parseInt((str ?? "").replace(/,/g, "").trim(), 10) || 0;
}

function mapTrendingRepository(raw: RawRepoScrape): TrendingRepo {
  return {
    id: raw.fullName,
    fullName: raw.fullName,
    url: raw.url,
    name: raw.name,
    owner: raw.owner,
    description: raw.description.trim(),
    language: raw.language.trim(),
    stars: parseNum(raw._starsRaw),
    forks: parseNum(raw._forksRaw),
    starsToday: parseNum(
      (raw._todayRaw ?? "").replace(/stars today/i, "").trim(),
    ),
  };
}

async function parseTrendingPage(response: Response): Promise<TrendingRepo[]> {
  const repos: RawRepoScrape[] = [];
  let current: RawRepoScrape | null = null;

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
          _starsRaw: "",
          _forksRaw: "",
          _todayRaw: "",
        };
        repos.push(current);
      },
    })
    .on("article.Box-row h2 a", {
      element(el) {
        if (!current) return;
        const href = el.getAttribute("href") ?? "";
        current.fullName = href.replace(/^\//, "");
        current.url = `https://github.com${href}`;
        const [owner, name] = current.fullName.split("/");
        current.owner = owner ?? "";
        current.name = name ?? current.fullName;
      },
    })
    .on("article.Box-row p.col-9", {
      text(chunk) {
        if (current) current.description += chunk.text;
      },
    })
    .on("article.Box-row [itemprop='programmingLanguage']", {
      text(chunk) {
        if (current) current.language += chunk.text;
      },
    })
    .on("article.Box-row a[href$='/stargazers']", {
      text(chunk) {
        if (current) current._starsRaw += chunk.text;
      },
    })
    .on("article.Box-row a[href$='/forks']", {
      text(chunk) {
        if (current) current._forksRaw += chunk.text;
      },
    })
    .on("article.Box-row .d-inline-block.float-sm-right", {
      text(chunk) {
        if (current) current._todayRaw += chunk.text;
      },
    });

  await rewriter.transform(response).arrayBuffer();
  return repos.map(mapTrendingRepository);
}

// ─── Public API ───────────────────────────────────────────────────────────────

type Period = "daily" | "weekly" | "monthly";

export async function fetchTrendingRepos(
  period: Period,
  language: string,
  env: Env,
): Promise<TrendingRepo[]> {
  const cacheKey = `${period}-${language}`;
  const cached = trendingCache.get(cacheKey);
  if (cached?.length) return cached;

  const url = `https://github.com/trending/${encodeURIComponent(language)}?since=${period}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TrendingBot/1.0)",
      Accept: "text/html",
    },
  });

  if (!res.ok) throw new Error(`GitHub trending fetch failed: ${res.status}`);

  const repos = await parseTrendingPage(res);
  if (!repos.length) {
    throw new Error("Parsed 0 repos — GitHub HTML structure may have changed");
  }

  trendingCache.set(cacheKey, repos);
  return repos;
}

function mapGitHubRepoResponse(raw: Record<string, any>): GitHubRepo {
  return {
    id: raw.full_name,
    fullName: raw.full_name,
    htmlUrl: raw.html_url,
    stars: raw.stargazers_count,
    owner: raw.owner.login,
    defaultBranch: raw.default_branch,
    createdAt: Math.floor(new Date(raw.created_at).getTime() / 1000),
    pushedAt: Math.floor(new Date(raw.pushed_at).getTime() / 1000),
    description: raw.description,
    language: raw.language,
    topics: raw.topics ?? [],
    forks: raw.forks_count,
    readmeUrl: `${raw.html_url}/blob/main/README.md`,
  };
}

export async function fetchGitHubRepo(
  repoId: string,
  env: Env,
): Promise<{ repo: GitHubRepo; isCached: boolean }> {
  const cached = repoCache.get(repoId);
  if (cached) return { repo: cached, isCached: true };

  const response = await fetch(`https://api.github.com/repos/${repoId}`, {
    headers: githubHeaders(env),
  });

  if (!response.ok) {
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as any;
      if (body.message?.includes("rate limit"))
        throw new RateLimitError("GitHub API rate limit exceeded");
    }
    if (response.status === 404)
      throw new NotFoundError("Repository not found");
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const raw = (await response.json()) as Record<string, any>;
  const repo = mapGitHubRepoResponse(raw);
  repoCache.set(repoId, repo);
  return { repo, isCached: false };
}

// ─── README ───────────────────────────────────────────────────────────────────

function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function resolveMediaUrls(
  html: string,
  fullName: string,
  branch = "main",
): string {
  const base = `https://raw.githubusercontent.com/${fullName}/${branch}`;
  const replace = (tag: string, attr: string) =>
    new RegExp(
      `<${tag}([^>]*)\\s${attr}="(?!https?:\\/\\/)([^"]+)"([^>]*)>`,
      "gi",
    );

  const patchAttr = (
    match: string,
    before: string,
    src: string,
    after: string,
  ) => match.replace(src, `${base}/${src.replace(/^\.\//, "")}`);

  return html
    .replace(replace("img", "src"), patchAttr)
    .replace(replace("video", "src"), patchAttr)
    .replace(replace("source", "src"), patchAttr);
}

function stripBadgeLineBreaks(html: string): string {
  return html.replace(/<\/a>\s*<br\s*\/?>\s*(<a\s)/gi, "</a>\n$1");
}

async function renderGitHubMarkdown(
  content: string,
  fullName: string,
  env: Env,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
        ...githubHeaders(env),
      },
      body: JSON.stringify({ text: content, mode: "gfm", context: fullName }),
    });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  }
}

function stripReadmeForAI(content: string): string {
  return content
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

export async function fetchAndRenderReadme(
  repo: GitHubRepo,
  env: Env,
  forAI = false,
): Promise<{ readmeContent: string; readmeHtml: string }> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo.fullName}/readme`,
      { headers: githubHeaders(env) },
    );
    if (!res.ok) return { readmeContent: "", readmeHtml: "" };

    const data = (await res.json()) as { content: string };
    let readmeContent = decodeBase64(data.content);

    let readmeHtml =
      (await renderGitHubMarkdown(readmeContent, repo.fullName, env)) ?? "";
    if (readmeHtml) {
      readmeHtml = resolveMediaUrls(
        readmeHtml,
        repo.fullName,
        repo.defaultBranch,
      );
      readmeHtml = stripBadgeLineBreaks(readmeHtml);
    }

    if (forAI) readmeContent = stripReadmeForAI(readmeContent);
    return { readmeContent, readmeHtml };
  } catch (err) {
    console.error(
      "README fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return { readmeContent: "", readmeHtml: "" };
  }
}

// ─── Shared GitHub Headers ────────────────────────────────────────────────────

function githubHeaders(env: Env): Record<string, string> {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitDigest-Worker",
    ...(env.GITHUB_TOKEN ? { Authorization: `token ${env.GITHUB_TOKEN}` } : {}),
  };
}
