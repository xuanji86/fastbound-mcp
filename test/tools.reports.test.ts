import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../src/writeGuard.js";
import { reportTools } from "../src/tools/reports.js";

function text(r: CallToolResult): string {
  const p = r.content[0];
  return p && p.type === "text" ? p.text : "";
}

/** Context whose downloadBinary records each call's path + opts. */
function ctxWith(defaultAuditUser: string | undefined) {
  const calls: { path: string; opts: { auditUser?: string } | undefined }[] = [];
  const ctx = {
    config: { alias: "main", defaultAuditUser, accountNumber: "10001" },
    client: {
      downloadBinary: async (path: string, opts?: { auditUser?: string }) => {
        calls.push({ path, opts });
        return { bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf", filename: "f.pdf" };
      },
    },
  } as unknown as ToolContext;
  return { ctx, calls };
}

const tool = (name: string) => reportTools.find((t) => t.name === name)!;

describe("download_4473 X-AuditUser", () => {
  it("sends the account default audit user", async () => {
    const { ctx, calls } = ctxWith("a@b.com");
    const res = await tool("download_4473").handler({ form4473Id: "f1" }, ctx);
    expect(text(res)).toMatch(/^OK/);
    expect(calls).toEqual([{ path: "/Form4473s/Download/f1", opts: { auditUser: "a@b.com" } }]);
  });

  it("prefers the per-call auditUser", async () => {
    const { ctx, calls } = ctxWith("a@b.com");
    await tool("download_4473").handler({ form4473Id: "f1", auditUser: "c@d.com" }, ctx);
    expect(calls[0]?.opts?.auditUser).toBe("c@d.com");
  });

  it("blocks without calling FastBound when no audit user is available", async () => {
    const { ctx, calls } = ctxWith(undefined);
    const res = await tool("download_4473").handler({ form4473Id: "f1" }, ctx);
    expect(text(res)).toMatch(/^BLOCKED/);
    expect(calls).toHaveLength(0);
  });
});

describe("download_attachment X-AuditUser", () => {
  it("passes the audit user when configured and still downloads without one", async () => {
    const withAudit = ctxWith("a@b.com");
    await tool("download_attachment").handler({ attachmentId: "x" }, withAudit.ctx);
    expect(withAudit.calls[0]?.opts?.auditUser).toBe("a@b.com");

    const without = ctxWith(undefined);
    const res = await tool("download_attachment").handler({ attachmentId: "x" }, without.ctx);
    expect(text(res)).toMatch(/^OK/);
    expect(without.calls[0]?.opts?.auditUser).toBeUndefined();
  });
});
