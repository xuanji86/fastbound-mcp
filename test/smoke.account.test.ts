/**
 * Opt-in live connectivity smoke test. Read-only. Runs only when real credentials
 * are present in the environment (a FastBound TEST account is recommended); otherwise
 * it is skipped. Never exercises write tools.
 *
 *   FASTBOUND_ACCOUNT_NUMBER=... FASTBOUND_API_KEY=... npx vitest run test/smoke.account.test.ts
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { FastBoundClient } from "../src/client.js";
import type { Account } from "../src/types.js";

const hasCreds = Boolean(process.env.FASTBOUND_ACCOUNT_NUMBER && process.env.FASTBOUND_API_KEY);

describe.skipIf(!hasCreds)("live: get_account", () => {
  it("connects and returns the account", async () => {
    const client = new FastBoundClient(loadConfig());
    const account = await client.get<Account>("/Account");
    expect(account).toBeTruthy();
    expect(typeof account.number).toBe("number");
    // eslint-disable-next-line no-console
    console.log(`Connected to FastBound account "${account.name}" (#${account.number}).`);
  });
});
