import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const legacy = {
  FASTBOUND_ACCOUNT_NUMBER: "12345",
  FASTBOUND_API_KEY: "secret-key",
};

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
const only = (o: Record<string, string>) => {
  const cfg = loadConfig(env(o));
  expect(cfg.accounts).toHaveLength(1);
  return cfg.accounts[0]!;
};

describe("loadConfig — single (legacy) account", () => {
  it("loads required fields and sensible defaults", () => {
    const cfg = loadConfig(env({ ...legacy }));
    const a = cfg.accounts[0]!;
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.defaultAlias).toBe("default");
    expect(a.alias).toBe("default");
    expect(a.accountNumber).toBe("12345");
    expect(a.apiKey).toBe("secret-key");
    expect(a.allowWrites).toBe(false);
    expect(a.baseUrl).toBe("https://cloud.fastbound.com");
    expect(a.defaultAuditUser).toBeUndefined();
    expect(a.apiVersion).toBeUndefined();
  });

  it("throws a clear error when account number is missing", () => {
    expect(() => loadConfig(env({ FASTBOUND_API_KEY: "k" }))).toThrow(/FASTBOUND_ACCOUNT_NUMBER/);
  });

  it("throws a clear error when api key is missing", () => {
    expect(() => loadConfig(env({ FASTBOUND_ACCOUNT_NUMBER: "12345" }))).toThrow(/FASTBOUND_API_KEY/);
  });

  it("treats blank/whitespace required vars as missing", () => {
    expect(() => loadConfig(env({ FASTBOUND_ACCOUNT_NUMBER: "   ", FASTBOUND_API_KEY: "k" }))).toThrow(
      /FASTBOUND_ACCOUNT_NUMBER/,
    );
  });

  it("parses the write switch from common truthy spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      expect(only({ ...legacy, FASTBOUND_ALLOW_WRITES: v }).allowWrites).toBe(true);
    }
    for (const v of ["false", "0", "no", "", "anything"]) {
      expect(only({ ...legacy, FASTBOUND_ALLOW_WRITES: v }).allowWrites).toBe(false);
    }
  });

  it("strips trailing slashes from a custom base url", () => {
    expect(only({ ...legacy, FASTBOUND_BASE_URL: "https://example.test/" }).baseUrl).toBe(
      "https://example.test",
    );
  });

  it("carries optional audit user and api version when present", () => {
    const a = only({ ...legacy, FASTBOUND_AUDIT_USER: "clerk@ffl.com", FASTBOUND_API_VERSION: "1.0" });
    expect(a.defaultAuditUser).toBe("clerk@ffl.com");
    expect(a.apiVersion).toBe("1.0");
  });
});

const multi = {
  FASTBOUND_ACCOUNTS: "main, sandbox",
  FASTBOUND_MAIN_ACCOUNT_NUMBER: "10001",
  FASTBOUND_MAIN_API_KEY: "main-key",
  FASTBOUND_MAIN_AUDIT_USER: "info@main.test",
  FASTBOUND_MAIN_ALLOW_WRITES: "true",
  FASTBOUND_MAIN_LABEL: "Main Shop (prod)",
  FASTBOUND_SANDBOX_ACCOUNT_NUMBER: "10003",
  FASTBOUND_SANDBOX_API_KEY: "sandbox-key",
};

describe("loadConfig — multiple accounts", () => {
  it("loads each alias with its own credentials and write switch", () => {
    const cfg = loadConfig(env(multi));
    expect(cfg.accounts.map((a) => a.alias)).toEqual(["main", "sandbox"]);
    const [main, sandbox] = cfg.accounts;
    expect(main!.accountNumber).toBe("10001");
    expect(main!.apiKey).toBe("main-key");
    expect(main!.allowWrites).toBe(true);
    expect(main!.label).toBe("Main Shop (prod)");
    expect(sandbox!.accountNumber).toBe("10003");
    expect(sandbox!.allowWrites).toBe(false); // no per-account or global switch
    expect(sandbox!.label).toBe("sandbox"); // falls back to the alias
  });

  it("defaults to the first listed account and honours FASTBOUND_DEFAULT_ACCOUNT", () => {
    expect(loadConfig(env(multi)).defaultAlias).toBe("main");
    expect(loadConfig(env({ ...multi, FASTBOUND_DEFAULT_ACCOUNT: "SANDBOX" })).defaultAlias).toBe(
      "sandbox",
    );
  });

  it("rejects a default alias that is not configured", () => {
    expect(() => loadConfig(env({ ...multi, FASTBOUND_DEFAULT_ACCOUNT: "cga" }))).toThrow(
      /not one of the configured accounts/,
    );
  });

  it("falls back to the global audit user / base url / write switch per account", () => {
    const cfg = loadConfig(
      env({
        ...multi,
        FASTBOUND_AUDIT_USER: "fallback@ffl.com",
        FASTBOUND_ALLOW_WRITES: "true",
        FASTBOUND_BASE_URL: "https://staging.test/",
      }),
    );
    const [main, sandbox] = cfg.accounts;
    expect(main!.defaultAuditUser).toBe("info@main.test"); // per-account wins
    expect(sandbox!.defaultAuditUser).toBe("fallback@ffl.com");
    expect(sandbox!.allowWrites).toBe(true);
    expect(sandbox!.baseUrl).toBe("https://staging.test");
  });

  it("names the missing per-account variable when credentials are incomplete", () => {
    const { FASTBOUND_SANDBOX_API_KEY: _drop, ...rest } = multi;
    expect(() => loadConfig(env(rest))).toThrow(/FASTBOUND_SANDBOX_API_KEY/);
  });

  it("rejects duplicate and empty alias lists", () => {
    expect(() => loadConfig(env({ ...multi, FASTBOUND_ACCOUNTS: "main,main" }))).toThrow(/Duplicate alias/);
    expect(() => loadConfig(env({ ...multi, FASTBOUND_ACCOUNTS: " , " }))).toThrow(
      /lists no account aliases/,
    );
  });

  it("maps dashed aliases onto underscored env vars", () => {
    const a = only({
      FASTBOUND_ACCOUNTS: "all-alpha",
      FASTBOUND_ALL_ALPHA_ACCOUNT_NUMBER: "10002",
      FASTBOUND_ALL_ALPHA_API_KEY: "sibling-key",
    });
    expect(a.alias).toBe("all-alpha");
    expect(a.accountNumber).toBe("10002");
  });
});
