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
  const calls: { path: string; opts: { auditUser?: string; method?: string } | undefined }[] = [];
  const ctx = {
    config: { alias: "main", defaultAuditUser, accountNumber: "10001" },
    client: {
      downloadBinary: async (path: string, opts?: { auditUser?: string; method?: string }) => {
        calls.push({ path, opts });
        return { bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf", filename: "f.pdf" };
      },
    },
  } as unknown as ToolContext;
  return { ctx, calls };
}

const tool = (name: string) => reportTools.find((t) => t.name === name)!;

// FastBound answers every /Download without X-AuditUser with 400 "Invalid Audit User".
const downloads: [string, Record<string, string>, string, Record<string, string>][] = [
  ["download_bound_book", {}, "/Downloads/BoundBook", { method: "POST" }],
  ["download_4473", { form4473Id: "f1" }, "/Form4473s/Download/f1", {}],
  ["download_attachment", { attachmentId: "a1" }, "/Attachments/Download/a1", {}],
  ["download_multiple_sale_report", { multipleSaleReportId: "r1", attachmentId: "a1" }, "/MultipleSaleReports/Download/r1/a/a1", {}],
];

describe.each(downloads)("%s X-AuditUser", (name, args, path, opts) => {
  it("sends the account default audit user, trimmed", async () => {
    const { ctx, calls } = ctxWith("  a@b.com ");
    const res = await tool(name).handler(args, ctx);
    expect(text(res)).toMatch(/^OK/);
    expect(calls).toEqual([{ path, opts: { ...opts, auditUser: "a@b.com" } }]);
  });

  it("prefers the per-call auditUser", async () => {
    const { ctx, calls } = ctxWith("a@b.com");
    await tool(name).handler({ ...args, auditUser: "c@d.com" }, ctx);
    expect(calls[0]?.opts?.auditUser).toBe("c@d.com");
  });

  it.each([undefined, "owner@osa"])("blocks without calling FastBound when the default is %s", async (def) => {
    const { ctx, calls } = ctxWith(def);
    const res = await tool(name).handler(args, ctx);
    expect(text(res)).toMatch(/^BLOCKED/);
    expect(text(res)).toContain('account "main"');
    expect(calls).toHaveLength(0);
  });
});
