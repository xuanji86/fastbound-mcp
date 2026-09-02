/**
 * Locate and load the server's .env so startup needs no shell wrapper.
 *
 * The launcher is then just `fastbound-mcp` (or `node dist/index.js`) on every
 * OS. Previously macOS sourced the file with `bash -c 'set -a && . ./.env'`,
 * which has no Windows equivalent.
 *
 * First existing candidate wins:
 *   1. $FASTBOUND_ENV_FILE               explicit override
 *   2. <package root>/.env               running from a clone (dist/.. or src/..)
 *   3. <user config>/fastbound-mcp/.env  global install
 *      — %APPDATA% on Windows, $XDG_CONFIG_HOME or ~/.config elsewhere
 *
 * Variables already in process.env win: process.loadEnvFile() does not overwrite
 * them, so an MCP `env` block beats the file and no file is required at all.
 *
 * Candidate 1 is deliberately NOT probed with existsSync: falling through from a
 * typo'd override would quietly load candidate 2 — which is the live bound book.
 * Save the file as UTF-8 with no BOM; a BOM corrupts the first key's name.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Path helpers for the target platform, so the win32 branch is testable off Windows. */
const joiner = (platform: string) => (platform === "win32" ? path.win32 : path.posix);

/** Per-user config dir for this server, following each platform's convention. */
function userConfigDir(env: NodeJS.ProcessEnv, home: string, platform: string): string {
  const p = joiner(platform);
  if (platform === "win32" && env.APPDATA) return p.join(env.APPDATA, "fastbound-mcp");
  const base = env.XDG_CONFIG_HOME || p.join(home, ".config");
  return p.join(base, "fastbound-mcp");
}

/** Candidate .env paths in priority order. Arguments exist so tests can pin them. */
export function envFileCandidates(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  moduleDir: string = MODULE_DIR,
  platform: string = process.platform,
): string[] {
  const p = joiner(platform);
  const out: string[] = [];
  if (env.FASTBOUND_ENV_FILE) out.push(env.FASTBOUND_ENV_FILE);
  out.push(p.join(moduleDir, "..", ".env"));
  out.push(p.join(userConfigDir(env, home, platform), ".env"));
  return out;
}

/**
 * Load the .env into process.env and return the file used, or undefined when no
 * file was found — not an error, since the credentials may come from the
 * environment. Malformed lines are skipped silently by Node's parser; only a
 * missing file throws, and only for an explicit override.
 */
export function loadEnvFile(): string | undefined {
  if (typeof process.loadEnvFile !== "function") {
    throw new Error(
      `fastbound-mcp needs Node >= 20.12 for process.loadEnvFile(); this is ${process.version}.`,
    );
  }
  const explicit = process.env.FASTBOUND_ENV_FILE;
  if (explicit) {
    // Fatal on ENOENT: pointing at a sandbox file and getting the live bound
    // book because of a typo is the one failure this module must not allow.
    const file = path.resolve(explicit);
    process.loadEnvFile(file);
    return file;
  }
  for (const file of envFileCandidates()) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
    return file;
  }
  return undefined;
}
