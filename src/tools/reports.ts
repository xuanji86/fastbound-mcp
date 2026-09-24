/**
 * Reports & document downloads. These are reads (they don't mutate A&D records) so
 * they are not gated by FASTBOUND_ALLOW_WRITES. Binaries are returned base64 with a
 * size cap (see binaryResult). The bound book export and 4473 download require an
 * X-AuditUser (without it FastBound answers 400 "Invalid Audit User"); the other
 * downloads send it whenever one is configured.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { binaryResult, blockedResult } from "../result.js";
import { auditUserArg } from "../schemas/common.js";
import { isValidAuditEmail, type ToolContext } from "../writeGuard.js";

/** Per-call auditUser, else the account default; undefined unless it is a valid email. */
function auditFor(args: { auditUser?: string }, ctx: ToolContext): string | undefined {
  const audit = (args.auditUser ?? ctx.config.defaultAuditUser)?.trim();
  return isValidAuditEmail(audit) ? audit : undefined;
}

const downloadBoundBook: ToolDef = {
  name: "download_bound_book",
  title: "Download bound book",
  description:
    "Generate and download the A&D bound book export. Requires an auditUser email (recorded by FastBound). Returns the file base64-encoded (large exports are summarised instead). Read.",
  inputSchema: { ...auditUserArg },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const audit = auditFor(args, ctx);
    if (!audit) {
      return blockedResult(
        "A valid auditUser email is required to generate the bound book. Pass `auditUser` or set FASTBOUND_AUDIT_USER.",
      );
    }
    const bin = await ctx.client.downloadBinary("/Downloads/BoundBook", { method: "POST", auditUser: audit });
    return binaryResult("bound book", bin.bytes, bin.contentType, bin.filename);
  },
};

const download4473: ToolDef = {
  name: "download_4473",
  title: "Download 4473",
  description:
    "Download a completed ATF Form 4473 PDF by its id. Requires an auditUser email (recorded by FastBound). Returns the file base64-encoded. Read.",
  inputSchema: { form4473Id: z.string().min(1).describe("GUID of the 4473."), ...auditUserArg },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const audit = auditFor(args, ctx);
    if (!audit) {
      return blockedResult(
        "A valid auditUser email is required to download a 4473. Pass `auditUser` or set FASTBOUND_AUDIT_USER.",
      );
    }
    const bin = await ctx.client.downloadBinary(`/Form4473s/Download/${encodeURIComponent(args.form4473Id)}`, {
      auditUser: audit,
    });
    return binaryResult(`4473 ${args.form4473Id}`, bin.bytes, bin.contentType, bin.filename);
  },
};

const downloadAttachment: ToolDef = {
  name: "download_attachment",
  title: "Download attachment",
  description: "Download an attachment file by its id. Returns the file base64-encoded. Read.",
  inputSchema: { attachmentId: z.string().min(1).describe("GUID of the attachment."), ...auditUserArg },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const bin = await ctx.client.downloadBinary(`/Attachments/Download/${encodeURIComponent(args.attachmentId)}`, {
      auditUser: auditFor(args, ctx),
    });
    return binaryResult(`attachment ${args.attachmentId}`, bin.bytes, bin.contentType, bin.filename);
  },
};

const downloadMultipleSaleReport: ToolDef = {
  name: "download_multiple_sale_report",
  title: "Download multiple-sale report",
  description:
    "Download a Multiple Sale report attachment (ATF Form 3310.4/5300.9) by report id and attachment id. Returns the file base64-encoded. Read.",
  inputSchema: {
    multipleSaleReportId: z.string().min(1).describe("GUID of the multiple-sale report."),
    attachmentId: z.string().min(1).describe("GUID of the attachment within the report."),
    ...auditUserArg,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const bin = await ctx.client.downloadBinary(
      `/MultipleSaleReports/Download/${encodeURIComponent(args.multipleSaleReportId)}/a/${encodeURIComponent(args.attachmentId)}`,
      { auditUser: auditFor(args, ctx) },
    );
    return binaryResult("multiple-sale report", bin.bytes, bin.contentType, bin.filename);
  },
};

export const reportTools: ToolDef[] = [
  downloadBoundBook,
  download4473,
  downloadAttachment,
  downloadMultipleSaleReport,
];
