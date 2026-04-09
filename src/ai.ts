import type {
  AIMessage,
  AIProvider,
  GitHubRepo,
  TrendingRepo,
  Env,
} from "./types";
import { AIApiError } from "./errors";

// ─── Provider Detection ───────────────────────────────────────────────────────

export function detectProvider(apiKey: string): AIProvider {
  if (apiKey.startsWith("gsk_")) return "groq";
  if (apiKey.startsWith("sk-or-")) return "openrouter";
  if (apiKey.startsWith("sk-")) return "openai";
  return "gemini";
}

// ─── Unified AI Caller ────────────────────────────────────────────────────────

interface ProviderConfig {
  url: string;
  body: Record<string, unknown>;
  needsBearer: boolean;
}

function buildProviderConfig(
  messages: AIMessage[],
  apiKey: string,
  env?: Env,
): ProviderConfig {
  const provider = detectProvider(apiKey);

  switch (provider) {
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        body: {
          model: env?.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          messages,
          temperature: 0.45,
          max_tokens: 4096,
        },
        needsBearer: true,
      };
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        body: {
          model: env?.OPENROUTER_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free",
          messages,
          temperature: 0.45,
          max_tokens: 4096,
        },
        needsBearer: true,
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        body: {
          model: env?.OPENAI_MODEL ?? "gpt-4o-mini",
          messages,
          temperature: 0.45,
          max_tokens: 4096,
        },
        needsBearer: true,
      };
    case "gemini": {
      const [system, user] = [
        messages.find((m) => m.role === "system")?.content ?? "",
        messages.find((m) => m.role === "user")?.content ?? "",
      ];
      const geminiModel = env?.GEMINI_MODEL ?? "gemini-2.0-flash-lite";
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
        body: {
          contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
          generationConfig: { temperature: 0.45, maxOutputTokens: 4096 },
        },
        needsBearer: false,
      };
    }
  }
}

function extractContent(
  provider: AIProvider,
  data: Record<string, any>,
): string {
  if (provider === "gemini") {
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
  return data.choices?.[0]?.message?.content ?? "";
}

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  env?: Env,
): Promise<string> {
  const messages: AIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const config = buildProviderConfig(messages, apiKey, env);
  const provider = detectProvider(apiKey);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.needsBearer) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify(config.body),
  });

  const data = (await response.json()) as Record<string, any>;

  if (!response.ok) {
    console.error(`AI API error [${response.status}]:`, data.error?.message);
    throw AIApiError.fromProviderStatus(response.status, data);
  }

  if (data.error) {
    throw new AIApiError(data.error.message ?? JSON.stringify(data.error));
  }

  const content = extractContent(provider, data);
  if (!content) throw new Error("No content received from AI provider");
  return content;
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

export function buildSummarizePrompt(
  content: string,
  lang: string,
  repo: GitHubRepo,
): { systemPrompt: string; userPrompt: string } {
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
Who would use this and in what scenarios. Be specific.

### 📈 Traction & Signals
Interpret the star count and forks in context of the repo's age and domain.

### 💡 Why It Stands Out
1-2 sentences on what makes this repo notable.

## Tone & Formatting Rules
- Be precise and technical — avoid vague marketing language.
- Use **bold** only for proper nouns, library names, and critical terms.
- Target length: 350-550 words. Prioritize clarity over completeness.
- If README is missing or sparse, reason from metadata — clearly note when inferring.`;

  const userPrompt = `Analyze the following GitHub repository and produce a structured technical summary.

${content}

${JSON.stringify(repo, null, 2)}

Focus on actionable insight: what exactly does this do, how is it built, and why should a developer care?`;

  return { systemPrompt, userPrompt };
}

export function buildWordcloudPrompt(
  repos: Partial<TrendingRepo>[],
  period: string,
  language: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a technology intelligence analyst specializing in open source trends.

Your task: analyze GitHub trending repositories and return a structured JSON object for a word cloud visualization.

## Analysis Strategy
- Extract technical terms: languages, frameworks, libraries, domains, architectural concepts
- Normalize variants: "machine-learning", "ml", "machine learning" → "machine-learning"
- Suppress noise: ignore generic words (tool, project, simple, awesome, build, based, use, support, fast, easy, new, app, make, help, open, data, list)
- Weight by: repo count mentioning term + star velocity (starsToday) + total stars

## Categorization Rules
- "language"   → programming/scripting language
- "framework"  → library or framework
- "domain"     → problem space (ai/ml, devops, security, web, mobile, data …)
- "concept"    → architectural or paradigm term (rag, agent, microservice, wasm, cli …)

## JSON Schema (return ONLY this, no markdown fences, no explanation)
{
  "words": [{ "text": string, "size": number, "category": string, "repos": number, "weight": number }],
  "categories": { "languages": { "count": number, "totalWeight": number }, "frameworks": { "count": number, "totalWeight": number }, "domains": { "count": number, "totalWeight": number }, "concepts": { "count": number, "totalWeight": number } },
  "insights": [string],
  "trends": { "emerging": [string], "established": [string], "rising": [string] }
}

## Hard Constraints
- words array: 20-50 entries, size integer in [10, 30], no duplicates
- insights: reference actual numbers, no vague claims
- Return ONLY valid JSON`;

  const userPrompt = `Analyze the following ${repos.length} GitHub trending repositories (${period} / lang filter: "${language || "all"}").

${JSON.stringify(repos, null, 2)}

Return the JSON object. No markdown, no explanation.`;

  return { systemPrompt, userPrompt };
}

export function buildTranslationPrompt(
  text: string,
  targetLang: string,
): { systemPrompt: string; userPrompt: string } {
  const direction =
    targetLang === "vi"
      ? "Translate the following English text to Vietnamese"
      : "Translate the following text to English";

  return {
    systemPrompt:
      "You are a professional translator. Translate accurately while preserving the original meaning and tone.",
    userPrompt: `${direction}. Keep the meaning and tone:\n\n${text}`,
  };
}
