import type { AIErrorCode } from "./types";

export class RateLimitError extends Error {
  constructor(message = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when the upstream AI provider returns an error.
 *
 * `errorCode` — stable machine-readable token forwarded to the client.
 * `httpStatus` — HTTP status the worker should use in its own response.
 */
export class AIApiError extends Error {
  readonly errorCode: AIErrorCode;
  readonly httpStatus: number;

  constructor(
    message: string,
    {
      errorCode = "ai_error",
      httpStatus = 502,
    }: { errorCode?: AIErrorCode; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = "AIApiError";
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
  }

  static fromProviderStatus(
    status: number,
    errorData: { error?: { code?: string; message?: string } },
  ): AIApiError {
    const msg =
      errorData.error?.message ??
      (errorData.error
        ? JSON.stringify(errorData.error)
        : `AI API error ${status}`);

    let errorCode: AIErrorCode = "ai_error";
    let httpStatus = 502;

    if (status === 401) {
      errorCode = "invalid_api_key";
      httpStatus = 401;
    } else if (status === 429) {
      const isQuota =
        errorData.error?.code === "insufficient_quota" ||
        msg.toLowerCase().includes("quota") ||
        msg.toLowerCase().includes("billing") ||
        msg.toLowerCase().includes("exceeded your current quota");
      errorCode = isQuota ? "quota_exceeded" : "rate_limit";
      httpStatus = 429;
    } else if (status === 403) {
      errorCode = "forbidden";
      httpStatus = 403;
    }

    return new AIApiError(msg, { errorCode, httpStatus });
  }
}
