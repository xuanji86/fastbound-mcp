import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadConfig, type AccountConfig } from "../src/config.js";
import { AccountRegistry, accountTag, schemaFor, tagResult } from "../src/accounts.js";
import type { ToolDef } from "../src/tools/types.js";
import { accountTools } from "../src/tools/account.js";
import { allTools } from "../src/tools/index.js";

const config = loadConfig({
  FASTBOUND_ACCOUNTS: "main,sibling",
  FASTBOUND_MAIN_ACCOUNT_NUMBER: "10001",
  FASTBOUND_MAIN_API_KEY: "main-key",
  FASTBOUND_MAIN_ALLOW_WRITES: "true",
  FASTBOUND_SIBLING_ACCOUNT_NUMBER: "10002",
  FASTBOUND_SIBLING_API_KEY: "sibling-key",
} as NodeJS.ProcessEnv);

const text = (r: CallToolResult): string => {
  const p = r.content[0];
  return p && p.type === "text" ? p.text : "";
};

const find = (name: string): ToolDef => {
  const t = accountTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("AccountRegistry", () => {
  it("starts on the default account and resolves by alias or number", () => {
    const reg = new AccountRegistry(config);
    expect(reg.active.alias).toBe("main");
    expect(reg.resolve().alias).toBe("main");
    expect(reg.resolve("sibling").alias).toBe("sibling");
    expect(reg.resolve("SIBLING").alias).toBe("sibling");
    expect(reg.resolve("10002").alias).toBe("sibling");
    expect(reg.resolve("  ").alias).toBe("main"); // blank === not specified
  });

  it("throws with the configured list on an unknown account instead of falling back", () => {
    const reg = new AccountRegistry(config);
    expect(() => reg.resolve("cga")).toThrow(/Unknown account "cga".*main \(#10001\).*sibling \(#10002\)/s);
  });

  it("switches the active account and leaves the others reachable", () => {
    const reg = new AccountRegistry(config);
    expect(reg.use("10002").alias).toBe("sibling");
    expect(reg.active.alias).toBe("sibling");
    expect(reg.isActive(reg.resolve("main"))).toBe(false);
    expect(reg.resolve().alias).toBe("sibling");
  });

  it("memoises one client per account", () => {
    const reg = new AccountRegistry(config);
    const main = reg.resolve("main");
    expect(reg.client(main)).toBe(reg.client(main));
    expect(reg.client(main)).not.toBe(reg.client(reg.resolve("sibling")));
  });
});

describe("account argument injection", () => {
  it("adds an optional `account` to every API tool and to none of the local ones", () => {
    for (const tool of allTools) {
      const shape = schemaFor(tool);
      if (tool.local) {
        expect(shape).toBe(tool.inputSchema);
      } else {
        expect(shape.account).toBeDefined();
        expect(shape.account!.isOptional()).toBe(true);
        expect(Object.keys(shape)).toHaveLength(Object.keys(tool.inputSchema).length + 1);
      }
    }
  });

  it("refuses to shadow a tool's own `account` argument", () => {
    const clash = { ...find("get_account"), inputSchema: { account: z.string() } } as ToolDef;
    expect(() => schemaFor(clash)).toThrow(/collides/);
  });
});

describe("tagResult", () => {
  const account = { alias: "main", accountNumber: "10001" } as AccountConfig;
  const res = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }], isError: false });

  it("stamps the account right after the status tag", () => {
    expect(text(tagResult(res("OK — item 1"), account))).toBe("OK [main #10001] — item 1");
    expect(text(tagResult(res("DRY RUN — nothing was sent."), account))).toBe(
      "DRY RUN [main #10001] — nothing was sent.",
    );
    expect(text(tagResult(res("ERROR — 404"), account))).toBe("ERROR [main #10001] — 404");
  });

  it("prefixes text that carries no status tag, and leaves non-text content alone", () => {
    expect(text(tagResult(res("something else"), account))).toBe("[main #10001] something else");
    const binary: CallToolResult = { content: [{ type: "image", data: "x", mimeType: "image/png" }] };
    expect(tagResult(binary, account)).toBe(binary);
  });

  it("keeps extra content parts", () => {
    const two: CallToolResult = {
      content: [
        { type: "text", text: "OK — a" },
        { type: "text", text: "b" },
      ],
    };
    expect(tagResult(two, account).content).toHaveLength(2);
  });
});

describe("list_accounts / use_account", () => {
  const ctx = (reg: AccountRegistry) =>
    ({ accounts: reg, config: reg.active, client: {} }) as never;

  it("lists every account, flags the active one, and never leaks api keys", async () => {
    const reg = new AccountRegistry(config);
    const t = text(await find("list_accounts").handler({}, ctx(reg)));
    expect(t).toContain("active: main #10001");
    expect(t).toContain('"alias": "main"');
    expect(t).toContain('"alias": "sibling"');
    expect(t).toContain('"writesEnabled": false');
    expect(t).not.toContain("main-key");
    expect(t).not.toContain("sibling-key");
  });

  it("switches the active account and reports the write state of the new one", async () => {
    const reg = new AccountRegistry(config);
    const t = text(await find("use_account").handler({ account: "sibling" }, ctx(reg)));
    expect(reg.active.alias).toBe("sibling");
    expect(t).toContain("active account is now");
    expect(t).toContain(accountTag(reg.active));
    expect(t).toContain("Writes are disabled");
  });

  it("reports an unknown alias without switching", async () => {
    const reg = new AccountRegistry(config);
    await expect(find("use_account").handler({ account: "nope" }, ctx(reg))).rejects.toThrow(
      /Unknown account/,
    );
    expect(reg.active.alias).toBe("main");
  });
});
