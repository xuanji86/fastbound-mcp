import { describe, it, expect } from "vitest";
import path from "node:path";
import { envFileCandidates, loadEnvFile } from "../src/envFile.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("envFileCandidates — cross-platform .env lookup", () => {
  it("puts the explicit override first", () => {
    const got = envFileCandidates(env({ FASTBOUND_ENV_FILE: "/tmp/x.env" }), "/home/u", "/pkg/dist", "linux");
    expect(got[0]).toBe("/tmp/x.env");
    expect(got).toHaveLength(3);
  });

  it("omits the override slot when unset, and looks beside the package root", () => {
    const got = envFileCandidates(env({}), "/home/u", "/pkg/dist", "linux");
    expect(got).toHaveLength(2);
    expect(got[0]).toBe(path.posix.join("/pkg/dist", "..", ".env"));
  });

  it("falls back to ~/.config on linux/macOS", () => {
    const got = envFileCandidates(env({}), "/home/u", "/pkg/dist", "linux");
    expect(got[1]).toBe(path.posix.join("/home/u", ".config", "fastbound-mcp", ".env"));
  });

  it("honours XDG_CONFIG_HOME over the ~/.config default", () => {
    const got = envFileCandidates(env({ XDG_CONFIG_HOME: "/xdg" }), "/home/u", "/pkg/dist", "linux");
    expect(got[1]).toBe(path.posix.join("/xdg", "fastbound-mcp", ".env"));
  });

  it("uses %APPDATA% on win32", () => {
    const got = envFileCandidates(env({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }), "C:\\Users\\u", "C:\\pkg\\dist", "win32");
    expect(got[1]).toBe(path.win32.join("C:\\Users\\u\\AppData\\Roaming", "fastbound-mcp", ".env"));
  });

  it("falls back to the home dir on win32 when APPDATA is missing", () => {
    const got = envFileCandidates(env({}), "C:\\Users\\u", "C:\\pkg\\dist", "win32");
    expect(got[1]).toBe(path.win32.join("C:\\Users\\u", ".config", "fastbound-mcp", ".env"));
  });
});

describe("loadEnvFile — an explicit override never falls through", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "fb-env-"));

  it("loads the file named by FASTBOUND_ENV_FILE", () => {
    const file = path.join(tmp, "ok.env");
    writeFileSync(file, "FASTBOUND_TEST_MARKER=from_explicit\n");
    process.env.FASTBOUND_ENV_FILE = file;
    try {
      expect(loadEnvFile()).toBe(file);
      expect(process.env.FASTBOUND_TEST_MARKER).toBe("from_explicit");
    } finally {
      delete process.env.FASTBOUND_ENV_FILE;
      delete process.env.FASTBOUND_TEST_MARKER;
    }
  });

  it("throws rather than silently loading the next candidate (the live bound book)", () => {
    process.env.FASTBOUND_ENV_FILE = path.join(tmp, "typo-does-not-exist.env");
    try {
      expect(() => loadEnvFile()).toThrow();
    } finally {
      delete process.env.FASTBOUND_ENV_FILE;
    }
  });
});
