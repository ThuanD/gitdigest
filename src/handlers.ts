import type { Env, WordCloudData } from "./types";
import { LRUCache, TTLCache } from "./cache";
import {
  json,
  resolveClientApiKey,
  safeParseJson,
  errorResponse,
} from "./http";
import {
  fetchGitHubRepo,
  fetchTrendingRepos,
  fetchAndRenderReadme,
  repoCache,
} from "./github";
import {
  callAI,
  buildSummarizePrompt,
  buildWordcloudPrompt,
  buildTranslationPrompt,
} from "./ai";
import { extractBasicKeywords } from "./keywords";

// ─── Cache Instances ──────────────────────────────────────────────────────────

export const summaryCache = new LRUCache<string>(500);
export const askCache = new LRUCache<string>(1000);
export const wordcloudCache = new TTLCache<WordCloudData>(100, 30 * 60 * 1000);

// ─── /api/repos ───────────────────────────────────────────────────────────────

export async function handleRepos(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    const period = (url.searchParams.get("period") ?? "daily") as
      | "daily"
      | "weekly"
      | "monthly";
    const language = url.searchParams.get("lang") ?? "";
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
    );
    const limit = 15;

    const repos = await fetchTrendingRepos(period, language, env);
    const start = (page - 1) * limit;
    const pageRepos = repos.slice(start, start + limit);

    return json({
      repos: pageRepos,
      hasMore: start + limit < repos.length,
      feed: period,
    });
  } catch (error) {
    console.error("Trending fetch error:", error);
    return json({ error: "Failed to fetch trending repositories" }, 500);
  }
}

// ─── /api/repo ────────────────────────────────────────────────────────────────

export async function handleRepoDetails(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    const repoId = url.searchParams.get("repoId");
    if (!repoId) return json({ error: "Missing repository ID" }, 400);

    const { repo, isCached } = await fetchGitHubRepo(repoId, env);
    const { readmeContent, readmeHtml } = await fetchAndRenderReadme(repo, env);

    return json({
      ...repo,
      readmeContent,
      readmeHtml,
      rawApiResponse: repo,
      isCached,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── /api/summarize ───────────────────────────────────────────────────────────

export async function handleSummarize(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    const repoId = url.searchParams.get("repoId");
    if (!repoId)
      return json(
        { error: "Missing repository ID", errorCode: "bad_request" },
        400,
      );

    const lang = (url.searchParams.get("lang") ?? "en").slice(0, 12);
    const apiKey =
      resolveClientApiKey(request) || (env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      return json(
        {
          error: "No API key configured. Add your API key in settings.",
          errorCode: "no_api_key",
        },
        401,
      );
    }

    const cacheKey = `${repoId}_${lang}`;

    // 1. Exact cache hit
    const cached = summaryCache.get(cacheKey);
    if (cached) return json({ summary: cached, isCached: true });

    // 2. Translate from the opposite language if available
    const oppositeLang = lang === "en" ? "vi" : "en";
    const oppositeSummary = summaryCache.get(`${repoId}_${oppositeLang}`);
    if (oppositeSummary) {
      const translated = await translateText(oppositeSummary, lang, env);
      if (translated) {
        summaryCache.set(cacheKey, translated);
        return json({
          summary: translated,
          isTranslated: true,
          fromLang: oppositeLang,
        });
      }
    }

    // 3. Generate from scratch
    const summary = await generateSummary(repoId, lang, apiKey, env);
    summaryCache.set(cacheKey, summary);
    return json({ summary, isGenerated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── /api/ask ─────────────────────────────────────────────────────────────────

export async function handleAsk(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    let repoId: string | undefined;
    let question: string | undefined;
    let lang: string;
    let clientSummary: string;

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        string
      >;
      repoId = body.repoId;
      question = body.question;
      lang = (body.lang ?? "en").slice(0, 12);
      clientSummary =
        typeof body.summary === "string" ? body.summary.slice(0, 24_000) : "";
    } else {
      repoId = url.searchParams.get("repoId") ?? undefined;
      question = url.searchParams.get("question") ?? undefined;
      lang = (url.searchParams.get("lang") ?? "en").slice(0, 12);
      clientSummary = "";
    }

    if (!repoId)
      return json({ error: "Missing repoId", errorCode: "bad_request" }, 400);
    if (!question)
      return json({ error: "Missing question", errorCode: "bad_request" }, 400);

    const questionKey = question.slice(0, 100).replace(/[^a-zA-Z0-9]/g, "_");
    const cacheKey = `ask_${repoId}_${questionKey}_${lang}`;
    const cached = askCache.get(cacheKey);
    if (cached) return json({ answer: cached, isCached: true });

    const apiKey =
      resolveClientApiKey(request) || (env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      return json(
        { error: "No API key configured.", errorCode: "no_api_key" },
        401,
      );
    }

    // Resolve summary from server cache or client-supplied fallback
    const summary =
      summaryCache.get(`${repoId}_${lang}`) ??
      summaryCache.get(`${repoId}_en`) ??
      clientSummary;

    if (!summary) {
      return json(
        {
          error: "No summary found. Generate the summary first.",
          errorCode: "no_summary",
        },
        400,
      );
    }

    const systemPrompt = `You are a sharp, opinionated technical analyst reviewing GitHub repositories for senior developers.
Answer in the language matching ISO code: '${lang}'.
Be specific, concrete, and data-driven — cite signals from the summary when possible.
Use markdown formatting (bold key terms, short bullet lists only for distinct items).
Target length: 180–320 words. Never pad the response.`;

    const answer = await callAI(
      systemPrompt,
      `Repository summary:\n${summary}\n\nQuestion: ${question}`,
      apiKey,
    );
    askCache.set(cacheKey, answer);
    return json({ answer, isCached: false });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── /api/wordcloud ───────────────────────────────────────────────────────────

export async function handleWordCloud(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  try {
    const period = (url.searchParams.get("period") ?? "daily") as
      | "daily"
      | "weekly"
      | "monthly";
    const language = url.searchParams.get("lang") ?? "";
    const cacheKey = `${period}-${language}`;

    // 1. TTL cache hit
    const cached = wordcloudCache.get(cacheKey);
    if (cached) return json({ ...cached, isCached: true });

    // 2. Translate from opposite language
    const oppositeLang = language === "vi" ? "en" : "vi";
    const oppositeData = wordcloudCache.get(`${period}-${oppositeLang}`);
    if (oppositeData) {
      const translated = await translateWordCloud(oppositeData, language, env);
      if (translated) {
        wordcloudCache.set(cacheKey, translated);
        return json({
          ...translated,
          isTranslated: true,
          fromLang: oppositeLang,
        });
      }
    }

    // 3. Generate
    const repos = await fetchTrendingRepos(period, "", env);
    const apiKey =
      resolveClientApiKey(request) || (env.OPENAI_API_KEY ?? "").trim();

    if (!apiKey) {
      const wordData = extractBasicKeywords(repos);
      wordcloudCache.set(cacheKey, wordData);
      return json({ ...wordData, isGenerated: true });
    }

    const repoData = repos.map(
      ({ name, fullName, description, language: lang, stars, starsToday }) => ({
        name,
        fullName,
        description,
        language: lang,
        stars,
        starsToday,
      }),
    );

    const { systemPrompt, userPrompt } = buildWordcloudPrompt(
      repoData,
      period,
      language,
    );
    const raw = await callAI(systemPrompt, userPrompt, apiKey);

    let wordData: WordCloudData;
    try {
      wordData = safeParseJson<WordCloudData>(raw);
      if (!Array.isArray(wordData?.words) || wordData.words.length === 0) {
        throw new Error("Invalid structure: missing words array");
      }
      wordData.words = wordData.words.map((w) => ({
        ...w,
        size: Math.min(30, Math.max(10, Math.round(w.size))),
      }));
    } catch (parseErr) {
      console.error("Failed to parse AI wordcloud response:", parseErr);
      wordData = extractBasicKeywords(repos);
    }

    wordcloudCache.set(cacheKey, wordData);
    return json({ ...wordData, isGenerated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateSummary(
  repoId: string,
  lang: string,
  apiKey: string,
  env: Env,
): Promise<string> {
  const { repo } = await fetchGitHubRepo(repoId, env);
  const { readmeContent } = await fetchAndRenderReadme(repo, env, true);

  const content = [
    `Repository: ${repo.fullName}`,
    `Description: ${repo.description ?? "No description"}`,
    `URL: ${repo.htmlUrl}`,
    `Language: ${repo.language ?? "Unknown"}`,
    `Stars: ${repo.stars}`,
    `Forks: ${repo.forks}`,
    `Topics: ${repo.topics.join(", ")}`,
    readmeContent ? `\nREADME:\n${readmeContent}` : "",
  ].join("\n");

  const { systemPrompt, userPrompt } = buildSummarizePrompt(
    content,
    lang,
    repo,
  );
  return callAI(systemPrompt, userPrompt, apiKey);
}

async function translateText(
  text: string,
  targetLang: string,
  env: Env,
): Promise<string | null> {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  try {
    const { systemPrompt, userPrompt } = buildTranslationPrompt(
      text,
      targetLang,
    );
    return await callAI(systemPrompt, userPrompt, apiKey);
  } catch {
    return null;
  }
}

async function translateWordCloud(
  data: WordCloudData,
  targetLang: string,
  env: Env,
): Promise<WordCloudData | null> {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;

  try {
    const wordTexts = data.words.map((w) => w.text).join(", ");
    const prompt =
      targetLang === "vi"
        ? `Translate these English keywords to Vietnamese. Return as JSON array: ["t1","t2",...]\n\nKeywords: ${wordTexts}`
        : `Translate these keywords to English. Return as JSON array: ["t1","t2",...]\n\nKeywords: ${wordTexts}`;

    const raw = await callAI(
      "You are a professional translator. Return only a JSON array of translated keywords.",
      prompt,
      apiKey,
    );

    let translated: string[];
    try {
      translated = safeParseJson<string[]>(raw);
    } catch {
      translated = raw.split(",").map((w) => w.trim().replace(/['"]/g, ""));
    }

    return {
      ...data,
      words: data.words.map((word, i) => ({
        ...word,
        text: translated[i] ?? word.text,
      })),
    };
  } catch {
    return null;
  }
}
