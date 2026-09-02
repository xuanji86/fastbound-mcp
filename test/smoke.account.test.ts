/**
 * Opt-in live connectivity smoke test. Read-only. Checks EVERY configured account, so
 * it doubles as a credential check after adding one. Runs only when credentials are
 * present in the environment (a FastBound TEST account is recommended); otherwise it
 * is skipped. Never exercises write tools.
 *
 *   FASTBOUND_ENV_FILE=./.env npx vitest run test/smoke.account.test.ts
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "../src/envFile.js";
import { loadConfig } from "../src/config.js";
import { FastBoundClient } from "../src/client.js";
import type { Account } from "../src/types.js";

// Opt-in only: an explicit FASTBOUND_ENV_FILE pulls the credentials in, so a
// plain `npm test` still skips and never reaches the live bound book.
if (process.env.FASTBOUND_ENV_FILE) loadEnvFile();

const hasCreds = Boolean(
  process.env.FASTBOUND_ACCOUNTS ??
    (process.env.FASTBOUND_ACCOUNT_NUMBER && process.env.FASTBOUND_API_KEY),
);

describe.skipIf(!hasCreds)("live: get_account", () => {
  const config = hasCreds ? loadConfig() : { accounts: [] };
  for (const cfg of config.accounts) {
    it(`connects to ${cfg.alias} (#${cfg.accountNumber})`, async () => {
      const account = await new FastBoundClient(cfg).get<Account>("/Account");
      expect(account).toBeTruthy();
      expect(String(account.number)).toBe(cfg.accountNumber);
      // eslint-disable-next-line no-console
      console.log(`Connected to "${account.name}" (#${account.number}) as ${cfg.alias}.`);
    });
  }
});
