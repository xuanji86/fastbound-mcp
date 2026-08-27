/**
 * The write guard — the central safety mechanism.
 *
 * Every mutating tool's business handler is wrapped by `withWriteGuard`. Read tools
 * never touch this. The wrapper enforces, in order and BEFORE any network write:
 *   1. FASTBOUND_ALLOW_WRITES must be true            → else BLOCKED, nothing sent.
 *   2. A valid X-AuditUser email must resolve         → else BLOCKED, nothing sent.
 *   3. `describe()` builds the request plan ONCE      → preview and live send are identical.
 *   4. For dry-runnable tools without confirm:true    → DRY RUN preview, nothing sent.
 *
 * `describe()` builds both the dry-run preview and the exact request the inner handler
 * sends, so a preview can never drift from what actually executes.
 */
import type { AccountConfig } from "./config.js";
import type { FastBoundClient } from "./client.js";
import type { AccountRegistry } from "./accounts.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { blockedResult, dryRunResult } from "./result.js";

export interface ToolContext {
  /** Client bound to the account this call resolved to. */
  client: FastBoundClient;
  /** The resolved account's settings (write switch, audit user, …). */
  config: AccountConfig;
  /** Every configured account, for the account-management tools. */
  accounts: AccountRegistry;
}

export interface WritePlan {
  method: "POST" | "PUT" | "DELETE";
  /** Resolved endpoint path, relative to the account API root (e.g. "/Items/123"). */
  path: string;
  /** Resolved request body (undefined for bodyless DELETEs). */
  body?: unknown;
  /** One-line human summary of the effect. */
  summary: string;
  /** Optional note surfaced in the dry-run preview (e.g. an update's read-to-merge). */
  previewNote?: string;
}

/** Args common to every guarded write tool. */
export interface WriteArgs {
  auditUser?: string;
  confirm?: boolean;
}

export interface GuardOptions<A extends WriteArgs> {
  /**
   * true  → commit/destructive: default to dry-run, require confirm:true (ATF落账点).
   * false → staging/non-committing builder: execute directly once writes+audit pass.
   */
  dryRunnable: boolean;
  /** Build the request plan from validated args + resolved audit user. May be async. */
  describe: (args: A, ctx: ToolContext, audit: string) => WritePlan | Promise<WritePlan>;
}

export type GuardedRun<A extends WriteArgs> = (
  args: A,
  ctx: ToolContext,
  audit: string,
  plan: WritePlan,
) => Promise<CallToolResult>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidAuditEmail(value: string | undefined): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

export function withWriteGuard<A extends WriteArgs>(
  opts: GuardOptions<A>,
  run: GuardedRun<A>,
): (args: A, ctx: ToolContext) => Promise<CallToolResult> {
  return async (args: A, ctx: ToolContext): Promise<CallToolResult> => {
    // 1. Master switch.
    if (!ctx.config.allowWrites) {
      return blockedResult(
        `Writes are disabled for account "${ctx.config.alias}" (#${ctx.config.accountNumber}). ` +
          "Enable them for this account in the server environment (see .env.example). No request was sent.",
      );
    }

    // 2. Resolve + validate the audit user (per-call overrides env default).
    const candidate = (args.auditUser ?? ctx.config.defaultAuditUser)?.trim();
    if (!isValidAuditEmail(candidate)) {
      return blockedResult(
        "A valid X-AuditUser email is required for writes. Pass `auditUser`, or set a default audit " +
          `user for account "${ctx.config.alias}" in the server environment. No request was sent.`,
      );
    }
    const audit = candidate;

    // 3. Build the plan once (preview == live request).
    const plan = await opts.describe(args, ctx, audit);

    // 4. Dry-run gate for committing/destructive tools.
    if (opts.dryRunnable && args.confirm !== true) {
      return dryRunResult({ ...plan, audit, account: ctx.config });
    }

    // Execute: the inner handler sends exactly `plan`.
    return run(args, ctx, audit, plan);
  };
}
