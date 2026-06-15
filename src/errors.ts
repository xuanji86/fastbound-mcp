/**
 * Error types and HTTP-status → model-facing text mapping.
 *
 * FastBound returns ASP.NET-style error bodies. We defensively handle several
 * shapes (ProblemDetails `errors`, `modelState`, plain `message`/`title`) and
 * flatten field-level validation errors into bullet lines so the model can
 * self-correct its next call.
 */

export type HeaderBag = Record<string, string>;

export class FastBoundApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly headers: HeaderBag;
  readonly path: string;

  constructor(status: number, body: unknown, headers: HeaderBag, path: string) {
    super(`FastBound API error ${status} for ${path}`);
    this.name = "FastBoundApiError";
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.path = path;
  }
}

/** Thrown when retries are exhausted against a persistent 429. */
export class RateLimitError extends FastBoundApiError {
  readonly retryAfterMs: number;
  constructor(body: unknown, headers: HeaderBag, path: string, retryAfterMs: number) {
    super(429, body, headers, path);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Pull field-level validation messages out of whatever shape FastBound sent. */
export function flattenValidation(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const out: string[] = [];
  const record = body as Record<string, unknown>;
  const container = record.errors ?? record.modelState ?? record.ModelState ?? record.Errors;
  if (Array.isArray(container)) {
    // FastBound write errors: [{ message: "..." }] (sometimes with a field/property).
    for (const entry of container) {
      if (typeof entry === "string") {
        out.push(entry);
      } else if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        const msg = e.message ?? e.Message ?? e.errorMessage ?? JSON.stringify(e);
        const field = e.field ?? e.Field ?? e.propertyName ?? e.PropertyName;
        out.push(field ? `${String(field)}: ${String(msg)}` : String(msg));
      }
    }
  } else if (container && typeof container === "object") {
    // ProblemDetails / ASP.NET modelState: { field: [msgs] }.
    for (const [field, msgs] of Object.entries(container)) {
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const m of list) out.push(`${field}: ${String(m)}`);
    }
  }
  return out;
}

/** Best-effort single-line summary from an error body. */
function bodyMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body.trim() || undefined;
  if (typeof body === "object") {
    const r = body as Record<string, unknown>;
    const msg = r.message ?? r.Message ?? r.title ?? r.Title ?? r.detail ?? r.Detail ?? r.error;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  return undefined;
}

/** Map a FastBoundApiError to concise, actionable, model-facing text. */
export function formatApiError(err: FastBoundApiError): string {
  const msg = bodyMessage(err.body);
  const fields = flattenValidation(err.body);
  const fieldLines = fields.length ? "\n" + fields.map((f) => ` • ${f}`).join("\n") : "";

  switch (err.status) {
    case 400:
      return `Bad request (400): ${msg ?? "check field names and required values."}${fieldLines}`;
    case 401:
      return "Authentication failed (401). Verify FASTBOUND_ACCOUNT_NUMBER and FASTBOUND_API_KEY.";
    case 403:
      return `Forbidden (403). ${msg ?? "The API key lacks permission for this operation."}`;
    case 404:
      return `Not found (404) for ${err.path}. The id/serial may not exist in this account.`;
    case 409:
      return `Conflict (409): ${msg ?? "duplicate or already-committed record."}${fieldLines}`;
    case 422:
      return `Validation failed (422)${msg ? `: ${msg}` : ""}.${fieldLines || " No field details returned."}`;
    case 429:
      return `Rate limit exceeded (60 req/min). ${msg ?? "Retried and still throttled; try again shortly."}`;
    default:
      if (err.status >= 500) {
        return `FastBound server error (${err.status}). The request was NOT confirmed applied; do not blindly retry committing operations.`;
      }
      return `FastBound API error (${err.status})${msg ? `: ${msg}` : ""}.${fieldLines}`;
  }
}
