/**
 * FastBoundClient — the single HTTP boundary to the FastBound REST API.
 *
 * Responsibilities: Basic auth, header assembly (incl. X-AuditUser on writes),
 * rate-limit throttling, 429 backoff/retry, error mapping, and surfacing the
 * load-bearing `X-FastBound-*` response headers. The client never guesses an
 * audit user — write methods receive it explicitly from the write guard.
 */
import type { Config } from "./config.js";
import { Throttle } from "./throttle.js";
import { FastBoundApiError, RateLimitError, type HeaderBag } from "./errors.js";

type FetchFn = typeof fetch;

export interface ClientOptions {
  fetchFn?: FetchFn;
  throttle?: Throttle;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export interface ApiResponse<T> {
  data: T;
  headers: HeaderBag;
  status: number;
}

export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string;
  filename: string | undefined;
  headers: HeaderBag;
  status: number;
}

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;
export type Query = Record<string, QueryValue>;

interface RequestOpts {
  query?: Query;
  body?: unknown;
  auditUser?: string;
  accept?: string;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function headersToBag(headers: Headers): HeaderBag {
  const bag: HeaderBag = {};
  headers.forEach((value, key) => {
    bag[key.toLowerCase()] = value;
  });
  return bag;
}

/** Extract the FastBound side-effect signal headers (x-fastbound-*) from a bag. */
export function extractFastBoundHeaders(headers: HeaderBag): HeaderBag {
  const out: HeaderBag = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith("x-fastbound-")) out[key] = value;
  }
  return out;
}

/** Human-readable notes for the model derived from x-fastbound-* headers. */
export function fastBoundHeaderNotes(headers: HeaderBag): string[] {
  const notes: string[] = [];
  if (headers["x-fastbound-multiplesale"]) {
    notes.push(
      "A Multiple Sale report (ATF Form 3310.4/5300.9) was triggered by this disposition; a user must review and transmit it.",
    );
  }
  if (headers["x-fastbound-existingcontactid"]) {
    notes.push(
      `FastBound matched an existing contact (id ${headers["x-fastbound-existingcontactid"]}); your create/update may have deduplicated.`,
    );
  }
  if (headers["x-fastbound-acquisitionid"]) {
    notes.push(
      `An auto-acquisition was created in the receiving account (acquisition id ${headers["x-fastbound-acquisitionid"]}) by this FFL transfer.`,
    );
  }
  return notes;
}

function filenameFromDisposition(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const star = /filename\*=(?:UTF-8'')?["']?([^"';]+)/i.exec(value);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = /filename=["']?([^"';]+)/i.exec(value);
  return plain?.[1];
}

export class FastBoundClient {
  private readonly fetchFn: FetchFn;
  private readonly throttle: Throttle;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly authHeader: string;
  private readonly apiRoot: string;
  private readonly apiVersion: string | undefined;

  constructor(config: Config, opts: ClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.throttle = opts.throttle ?? new Throttle();
    this.sleep = opts.sleep ?? realSleep;
    this.maxRetries = opts.maxRetries ?? 3;
    this.authHeader =
      "Basic " + Buffer.from(`${config.accountNumber}:${config.apiKey}`).toString("base64");
    this.apiRoot = `${config.baseUrl}/${config.accountNumber}/api`;
    this.apiVersion = config.apiVersion;
  }

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(this.apiRoot + path);
    if (query) {
      for (const [key, raw] of Object.entries(query)) {
        if (raw === undefined || raw === null) continue;
        if (Array.isArray(raw)) {
          for (const v of raw) url.searchParams.append(key, String(v));
        } else {
          url.searchParams.set(key, String(raw));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(opts: RequestOpts): Headers {
    const headers = new Headers();
    headers.set("Authorization", this.authHeader);
    headers.set("Accept", opts.accept ?? "application/json");
    if (this.apiVersion) headers.set("x-api-version", this.apiVersion);
    if (opts.auditUser) headers.set("X-AuditUser", opts.auditUser);
    if (opts.body !== undefined) headers.set("Content-Type", "application/json");
    return headers;
  }

  private retryDelayMs(headers: Headers, attempt: number): number {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    }
    // Exponential backoff: 1s, 2s, 4s … capped at 8s.
    return Math.min(8000, 1000 * 2 ** (attempt - 1));
  }

  private async send(method: string, path: string, opts: RequestOpts): Promise<Response> {
    const url = this.buildUrl(path, opts.query);
    const headers = this.buildHeaders(opts);
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    let attempt = 0;
    for (;;) {
      await this.throttle.acquire();
      const res = await this.fetchFn(url, { method, headers, body });
      // Retry only on 429 (request was rejected before processing, so it is safe).
      if (res.status === 429 && attempt < this.maxRetries) {
        attempt += 1;
        await this.sleep(this.retryDelayMs(res.headers, attempt));
        continue;
      }
      if (res.status === 429) {
        const bag = headersToBag(res.headers);
        throw new RateLimitError(
          await safeParseBody(res),
          bag,
          path,
          this.retryDelayMs(res.headers, attempt),
        );
      }
      return res;
    }
  }

  private async request<T>(method: string, path: string, opts: RequestOpts = {}): Promise<ApiResponse<T>> {
    const res = await this.send(method, path, opts);
    const headers = headersToBag(res.headers);
    if (!res.ok) {
      throw new FastBoundApiError(res.status, await safeParseBody(res), headers, path);
    }
    return { data: await parseSuccess<T>(res), headers, status: res.status };
  }

  // ---- Public verbs -------------------------------------------------------

  async get<T>(path: string, query?: Query): Promise<T> {
    return (await this.request<T>("GET", path, { query })).data;
  }

  /** Like get(), but returns headers too (for reads that need response headers). */
  getWithHeaders<T>(path: string, query?: Query): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body: unknown, auditUser?: string, query?: Query): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, { body, auditUser, query });
  }

  put<T>(path: string, body: unknown, auditUser?: string, query?: Query): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, { body, auditUser, query });
  }

  del<T>(path: string, auditUser?: string, query?: Query): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path, { auditUser, query });
  }

  async downloadBinary(
    path: string,
    opts: { body?: unknown; query?: Query; auditUser?: string; method?: "GET" | "POST" } = {},
  ): Promise<BinaryResponse> {
    const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
    const res = await this.send(method, path, {
      ...opts,
      accept: "application/octet-stream",
    });
    const headers = headersToBag(res.headers);
    if (!res.ok) {
      throw new FastBoundApiError(res.status, await safeParseBody(res), headers, path);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      contentType: headers["content-type"] ?? "application/octet-stream",
      filename: filenameFromDisposition(headers["content-disposition"]),
      headers,
      status: res.status,
    };
  }
}

async function safeParseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function parseSuccess<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as T;
  }
  return text as unknown as T;
}
