import { AIApiError, NotFoundError, RateLimitError } from "./errors";

// ─── CORS ────────────────────────────────────────────────────────────────────

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpenAI-Key",
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

// ─── API Key Extraction ───────────────────────────────────────────────────────

/**
 * Extracts the AI provider API key from the request.
 * Checks (in order): Authorization Bearer header, X-OpenAI-Key header.
 * Strips any extra "Bearer " prefixes that some clients mistakenly double-add.
 */
export function resolveClientApiKey(request: Request): string {
  const authHeader = (request.headers.get("authorization") ?? "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+([\s\S]+)$/i);
  let token = (bearerMatch?.[1] ?? "").trim();

  // Strip any accidentally doubled "Bearer" prefixes
  while (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }

  return token || (request.headers.get("x-openai-key") ?? "").trim();
}

// ─── Safe JSON Parsing ────────────────────────────────────────────────────────

/**
 * Parses a JSON string that may be wrapped in markdown code fences.
 */
export function safeParseJson<T = unknown>(raw: string | null | undefined): T {
  if (!raw) throw new SyntaxError("Empty input");
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(stripped) as T;
}

// ─── Error → HTTP Response Mapping ───────────────────────────────────────────

export function errorResponse(error: unknown): Response {
  if (error instanceof AIApiError) {
    return json(
      { error: error.message, errorCode: error.errorCode },
      error.httpStatus,
    );
  }
  if (error instanceof NotFoundError) {
    return json({ error: error.message, errorCode: "not_found" }, 404);
  }
  if (error instanceof RateLimitError) {
    return json({ error: error.message, errorCode: "github_rate_limit" }, 429);
  }
  const msg = error instanceof Error ? error.message : "Internal server error";
  console.error("Unhandled error:", error);
  return json({ error: msg, errorCode: "server_error" }, 500);
}
