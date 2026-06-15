import { describe, it, expect, vi } from "vitest";
import { FastBoundClient, fastBoundHeaderNotes, extractFastBoundHeaders } from "../src/client.js";
import { FastBoundApiError, RateLimitError, formatApiError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const cfg: Config = Object.freeze({
  accountNumber: "12345",
  apiKey: "secret",
  defaultAuditUser: "clerk@ffl.com",
  allowWrites: true,
  baseUrl: "https://api.test",
  apiVersion: undefined,
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fetch stub that returns queued responses in order. */
function queuedFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no more queued responses");
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const noSleep = async () => undefined;

describe("FastBoundClient request building", () => {
  it("sends Basic auth, builds account-scoped URL, and sets X-AuditUser on writes", async () => {
    const { fn, calls } = queuedFetch([json(201, { id: "abc" })]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    await client.post("/Acquisitions", { type: "Purchase" }, "auditor@ffl.com");

    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.test/12345/api/Acquisitions");
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe(
      "Basic " + Buffer.from("12345:secret").toString("base64"),
    );
    expect(headers.get("x-audituser")).toBe("auditor@ffl.com");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("serialises query params, including arrays", async () => {
    const { fn, calls } = queuedFetch([json(200, { items: [] })]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    await client.get("/Items", { search: "glock", type: ["Pistol", "Rifle"], skip: 0 });
    expect(calls[0]!.url).toBe(
      "https://api.test/12345/api/Items?search=glock&type=Pistol&type=Rifle&skip=0",
    );
  });

  it("returns parsed JSON for reads", async () => {
    const { fn } = queuedFetch([json(200, { totalItems: 2, items: [{ id: "a" }] })]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    const data = await client.get<{ totalItems: number }>("/Items");
    expect(data.totalItems).toBe(2);
  });

  it("treats 204 as an empty body", async () => {
    const { fn } = queuedFetch([json(204, null)]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    const res = await client.del("/Items/abc", "auditor@ffl.com");
    expect(res.status).toBe(204);
    expect(res.data).toBeUndefined();
  });
});

describe("FastBoundClient error mapping", () => {
  const cases: { status: number; body: unknown; match: RegExp }[] = [
    { status: 401, body: { message: "no" }, match: /Authentication failed \(401\)/ },
    { status: 403, body: { message: "denied" }, match: /Forbidden \(403\)/ },
    { status: 404, body: { message: "x" }, match: /Not found \(404\)/ },
    { status: 409, body: { message: "duplicate serial" }, match: /Conflict \(409\): duplicate serial/ },
  ];

  for (const c of cases) {
    it(`maps ${c.status} to actionable text`, async () => {
      const { fn } = queuedFetch([json(c.status, c.body)]);
      const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
      await expect(client.get("/Items/abc")).rejects.toBeInstanceOf(FastBoundApiError);
      try {
        await new FastBoundClient(cfg, {
          fetchFn: queuedFetch([json(c.status, c.body)]).fn,
          sleep: noSleep,
        }).get("/Items/abc");
      } catch (err) {
        expect(formatApiError(err as FastBoundApiError)).toMatch(c.match);
      }
    });
  }

  it("formats FastBound's array-shaped error body ({errors:[{message}]})", async () => {
    // The real live shape observed from /Acquisitions/CreateAsPending.
    const body = { errors: [{ message: "You must specify an existing Contact's ContactId." }] };
    const { fn } = queuedFetch([json(400, body)]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    try {
      await client.post("/Acquisitions/CreateAsPending", {}, "a@b.com");
      throw new Error("should have thrown");
    } catch (err) {
      const text = formatApiError(err as FastBoundApiError);
      expect(text).toContain("You must specify an existing Contact's ContactId.");
      expect(text).not.toContain("[object Object]");
    }
  });

  it("flattens 422 validation errors into bullet lines", async () => {
    const body = { message: "Validation", errors: { "items[0].serial": ["required"], date: ["invalid"] } };
    const { fn } = queuedFetch([json(422, body)]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    try {
      await client.post("/Acquisitions", {}, "a@b.com");
      throw new Error("should have thrown");
    } catch (err) {
      const text = formatApiError(err as FastBoundApiError);
      expect(text).toMatch(/Validation failed \(422\)/);
      expect(text).toContain("items[0].serial: required");
      expect(text).toContain("date: invalid");
    }
  });
});

describe("FastBoundClient 429 handling", () => {
  it("retries on 429 then succeeds", async () => {
    const { fn, calls } = queuedFetch([
      json(429, { message: "slow down" }, { "retry-after": "1" }),
      json(429, { message: "slow down" }, { "retry-after": "1" }),
      json(200, { ok: true }),
    ]);
    const sleeps: number[] = [];
    const client = new FastBoundClient(cfg, {
      fetchFn: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxRetries: 3,
    });
    const data = await client.get<{ ok: boolean }>("/Items");
    expect(data.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("throws RateLimitError after exhausting retries", async () => {
    const { fn } = queuedFetch([
      json(429, {}),
      json(429, {}),
      json(429, {}),
      json(429, {}),
    ]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep, maxRetries: 3 });
    await expect(client.get("/Items")).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("X-FastBound-* headers", () => {
  it("extracts and describes side-effect headers", async () => {
    const { fn } = queuedFetch([
      json(201, { id: "d1" }, {
        "X-FastBound-MultipleSale": "true",
        "X-FastBound-AcquisitionId": "acq-9",
      }),
    ]);
    const client = new FastBoundClient(cfg, { fetchFn: fn, sleep: noSleep });
    const res = await client.post("/Dispositions/CreateAndCommit", {}, "a@b.com");
    const fb = extractFastBoundHeaders(res.headers);
    expect(fb["x-fastbound-multiplesale"]).toBe("true");
    const notes = fastBoundHeaderNotes(res.headers);
    expect(notes.join(" ")).toMatch(/Multiple Sale report/);
    expect(notes.join(" ")).toMatch(/auto-acquisition .*acq-9/);
  });
});
