import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  FASTBOUND_ACCOUNT_NUMBER: "12345",
  FASTBOUND_API_KEY: "secret-key",
};

describe("loadConfig", () => {
  it("loads required fields and sensible defaults", () => {
    const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(cfg.accountNumber).toBe("12345");
    expect(cfg.apiKey).toBe("secret-key");
    expect(cfg.allowWrites).toBe(false);
    expect(cfg.baseUrl).toBe("https://cloud.fastbound.com");
    expect(cfg.defaultAuditUser).toBeUndefined();
    expect(cfg.apiVersion).toBeUndefined();
  });

  it("throws a clear error when account number is missing", () => {
    expect(() => loadConfig({ FASTBOUND_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(
      /FASTBOUND_ACCOUNT_NUMBER/,
    );
  });

  it("throws a clear error when api key is missing", () => {
    expect(() =>
      loadConfig({ FASTBOUND_ACCOUNT_NUMBER: "12345" } as NodeJS.ProcessEnv),
    ).toThrow(/FASTBOUND_API_KEY/);
  });

  it("treats blank/whitespace required vars as missing", () => {
    expect(() =>
      loadConfig({ FASTBOUND_ACCOUNT_NUMBER: "   ", FASTBOUND_API_KEY: "k" } as NodeJS.ProcessEnv),
    ).toThrow(/FASTBOUND_ACCOUNT_NUMBER/);
  });

  it("parses the write switch from common truthy spellings", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      expect(loadConfig({ ...base, FASTBOUND_ALLOW_WRITES: v } as NodeJS.ProcessEnv).allowWrites).toBe(
        true,
      );
    }
    for (const v of ["false", "0", "no", "", "anything"]) {
      expect(loadConfig({ ...base, FASTBOUND_ALLOW_WRITES: v } as NodeJS.ProcessEnv).allowWrites).toBe(
        false,
      );
    }
  });

  it("strips trailing slashes from a custom base url", () => {
    const cfg = loadConfig({
      ...base,
      FASTBOUND_BASE_URL: "https://example.test/",
    } as NodeJS.ProcessEnv);
    expect(cfg.baseUrl).toBe("https://example.test");
  });

  it("carries optional audit user and api version when present", () => {
    const cfg = loadConfig({
      ...base,
      FASTBOUND_AUDIT_USER: "clerk@ffl.com",
      FASTBOUND_API_VERSION: "1.0",
    } as NodeJS.ProcessEnv);
    expect(cfg.defaultAuditUser).toBe("clerk@ffl.com");
    expect(cfg.apiVersion).toBe("1.0");
  });
});
