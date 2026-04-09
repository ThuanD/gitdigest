import type {
  TrendingRepo,
  WordCategory,
  WordCloudData,
  WordEntry,
} from "./types";

// ─── Vocabulary Sets ──────────────────────────────────────────────────────────

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

// ─── Classifier ───────────────────────────────────────────────────────────────

function classifyWord(word: string): WordCategory {
  if (KNOWN_LANGUAGES.has(word)) return "language";
  if (KNOWN_FRAMEWORKS.has(word)) return "framework";
  return "concept";
}

// ─── Basic Extraction (no AI) ─────────────────────────────────────────────────

export function extractBasicKeywords(repos: TrendingRepo[]): WordCloudData {
  const wordMap = new Map<string, { weight: number; category: WordCategory }>();

  let langCount = 0,
    fwCount = 0,
    conceptCount = 0;

  for (const repo of repos) {
    if (repo.language) {
      const lang = repo.language.toLowerCase();
      const entry = wordMap.get(lang) ?? {
        weight: 0,
        category: "language" as WordCategory,
      };
      entry.weight += 3;
      wordMap.set(lang, entry);
      langCount++;
    }

    const text = `${repo.description ?? ""} ${repo.name ?? ""}`.toLowerCase();
    for (const raw of text.split(/[\s\-_/]+/)) {
      const word = raw.replace(/[^a-z0-9.#+]/g, "");
      if (word.length < 3 || STOPWORDS.has(word)) continue;

      const category = classifyWord(word);
      const entry = wordMap.get(word) ?? { weight: 0, category };
      entry.weight += category === "language" ? 2 : 1;
      wordMap.set(word, entry);

      if (category === "framework") fwCount++;
      else if (category === "concept") conceptCount++;
    }
  }

  const words: WordEntry[] = Array.from(wordMap.entries())
    .sort(([, a], [, b]) => b.weight - a.weight)
    .slice(0, 40)
    .map(([text, { weight, category }]) => ({
      text,
      size: Math.min(30, Math.max(10, weight * 2)),
      category,
      repos: Math.ceil(weight / 2),
      weight,
    }));

  const byCategory = (cat: WordCategory) =>
    words.filter((w) => w.category === cat).map((w) => w.text);

  const topLangs = byCategory("language");
  const topFws = byCategory("framework");
  const topConcepts = byCategory("concept");

  const insights: string[] = [
    `${repos.length} repositories analyzed`,
    topLangs.length
      ? `Top languages: ${topLangs.slice(0, 3).join(", ")}`
      : null,
    topFws.length ? `Key frameworks: ${topFws.slice(0, 3).join(", ")}` : null,
    "Add an API key in Settings for AI-powered insights",
  ].filter((s): s is string => s !== null);

  return {
    words,
    categories: {
      languages: { count: langCount, totalWeight: langCount * 3 },
      frameworks: { count: fwCount, totalWeight: fwCount * 2 },
      domains: { count: 0, totalWeight: 0 },
      concepts: { count: conceptCount, totalWeight: conceptCount },
    },
    insights,
    trends: {
      emerging: topConcepts.slice(0, 4),
      established: topLangs.slice(0, 4),
      rising: topFws.slice(0, 4),
    },
  };
}
