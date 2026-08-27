import { describe, it, expect, vi } from "vitest";
import { withWriteGuard, type ToolContext, type WritePlan, type WriteArgs } from "../src/writeGuard.js";
import type { AccountConfig } from "../src/config.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function text(r: CallToolResult): string {
  const part = r.content[0];
  return part && part.type === "text" ? part.text : "";
}

/** Fake client whose verbs are spies, so we can assert "nothing was sent". */
function makeCtx(allowWrites: boolean, defaultAuditUser: string | undefined) {
  const client = {
    get: vi.fn(),
    getWithHeaders: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    downloadBinary: vi.fn(),
  };
  const config: AccountConfig = Object.freeze({
    alias: "main",
    label: "Main Shop",
    accountNumber: "10001",
    apiKey: "k",
    defaultAuditUser,
    allowWrites,
    baseUrl: "https://x.test",
    apiVersion: undefined,
  });
  const ctx = { client, config } as unknown as ToolContext;
  return { ctx, client };
}

const plan: WritePlan = {
  method: "POST",
  path: "/Acquisitions",
  body: { type: "Purchase" },
  summary: "Acquire 1 firearm",
};

interface Args extends WriteArgs {
  type?: string;
}

function build(dryRunnable: boolean) {
  const describe = vi.fn((): WritePlan => plan);
  const run = vi.fn(async (): Promise<CallToolResult> => ({
    content: [{ type: "text", text: "OK — executed" }],
    isError: false,
  }));
  const guarded = withWriteGuard<Args>({ dryRunnable, describe }, run);
  return { guarded, describe, run };
}

describe("withWriteGuard", () => {
  it("names the account in the dry-run preview so the target book is never hidden", async () => {
    const { ctx } = makeCtx(true, "clerk@ffl.com");
    const { guarded } = build(true);
    const res = await guarded({}, ctx);
    expect(text(res)).toContain("Account: Main Shop (main #10001)");
  });

  it("names the account when its write switch is off", async () => {
    const { ctx } = makeCtx(false, "clerk@ffl.com");
    const { guarded } = build(true);
    expect(text(await guarded({ confirm: true }, ctx))).toContain('account "main" (#10001)');
  });

  it("BLOCKS and sends nothing when writes are disabled", async () => {
    const { ctx, client } = makeCtx(false, "clerk@ffl.com");
    const { guarded, describe, run } = build(true);
    const res = await guarded({ confirm: true }, ctx);
    expect(text(res)).toMatch(/^BLOCKED — Writes are disabled/);
    expect(res.isError).toBe(false);
    expect(describe).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });

  it("BLOCKS and sends nothing when no valid audit user resolves", async () => {
    const { ctx, client } = makeCtx(true, undefined);
    const { guarded, describe, run } = build(true);
    const res = await guarded({ confirm: true }, ctx);
    expect(text(res)).toMatch(/valid X-AuditUser email is required/);
    expect(describe).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });

  it("BLOCKS on a malformed per-call audit email", async () => {
    const { ctx } = makeCtx(true, undefined);
    const { guarded, run } = build(true);
    const res = await guarded({ confirm: true, auditUser: "not-an-email" }, ctx);
    expect(text(res)).toMatch(/valid X-AuditUser email is required/);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns a DRY RUN preview (not executed) for a dry-runnable tool without confirm", async () => {
    const { ctx, client } = makeCtx(true, "clerk@ffl.com");
    const { guarded, describe, run } = build(true);
    const res = await guarded({}, ctx);
    const t = text(res);
    expect(t).toMatch(/^DRY RUN — nothing was sent/);
    expect(t).toContain("Would POST /Acquisitions");
    expect(t).toContain("X-AuditUser: clerk@ffl.com");
    expect(t).toContain('"type": "Purchase"'); // body from describe()
    expect(t).toMatch(/confirm:true to execute/);
    expect(describe).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });

  it("executes a dry-runnable tool when confirm:true, passing the same plan to run", async () => {
    const { ctx } = makeCtx(true, "clerk@ffl.com");
    const { guarded, describe, run } = build(true);
    const res = await guarded({ confirm: true }, ctx);
    expect(text(res)).toBe("OK — executed");
    expect(describe).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    const [, , audit, passedPlan] = run.mock.calls[0]!;
    expect(audit).toBe("clerk@ffl.com");
    expect(passedPlan).toBe(plan); // exact plan from describe()
  });

  it("executes a non-dry-runnable tool directly (no confirm needed)", async () => {
    const { ctx } = makeCtx(true, "clerk@ffl.com");
    const { guarded, run } = build(false);
    const res = await guarded({}, ctx);
    expect(text(res)).toBe("OK — executed");
    expect(run).toHaveBeenCalledOnce();
  });

  it("lets a per-call auditUser override the env default", async () => {
    const { ctx } = makeCtx(true, "default@ffl.com");
    const { guarded, run } = build(false);
    await guarded({ auditUser: "override@ffl.com" }, ctx);
    const [, , audit] = run.mock.calls[0]!;
    expect(audit).toBe("override@ffl.com");
  });
});
