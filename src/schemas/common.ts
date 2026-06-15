/**
 * Shared zod sub-schemas and helpers reused across tool input schemas.
 *
 * Schemas are expressed as raw shapes (objects of zod types) so they can be spread
 * into a tool's `inputSchema` and combined with tool-specific keys.
 */
import { z } from "zod";

export const pagination = {
  take: z.number().int().min(1).max(150).optional().describe("Page size (max 150)."),
  skip: z.number().int().min(0).optional().describe("Number of records to skip (pagination offset)."),
};

export const confirmFlag = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Set true to actually execute. Omit or false returns a DRY RUN preview that sends nothing.",
    ),
};

export const auditUserArg = {
  auditUser: z
    .string()
    .email()
    .optional()
    .describe(
      "Email recorded as X-AuditUser for the ATF audit trail. Overrides FASTBOUND_AUDIT_USER for this call. Must be an active user on the account.",
    ),
};

export const lookupArgs = {
  id: z.string().min(1).describe("The id value to look up."),
  idType: z
    .enum(["id", "externalId"])
    .optional()
    .describe("Whether `id` is the FastBound GUID (default) or your externalId."),
};

/** Build a GET-by-id-or-externalId path from a resource base path. */
export function lookupPath(base: string, args: { id: string; idType?: string }): string {
  return args.idType === "externalId"
    ? `${base}/GetByExternalId/${encodeURIComponent(args.id)}`
    : `${base}/${encodeURIComponent(args.id)}`;
}
