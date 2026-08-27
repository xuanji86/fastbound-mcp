/**
 * Account registry — which FastBound bound book a call talks to.
 *
 * Holds every configured account, memoises one client per account, and tracks the
 * ACTIVE account used when a call does not name one. Two ways to switch:
 *   • per call   — the `account` argument every API tool accepts (nothing is remembered)
 *   • per session — the `use_account` tool moves the active account
 *
 * Resolution accepts an alias ("main") or the raw account number ("10001"), both
 * case-insensitively, and fails loudly with the valid list rather than silently
 * falling back to the active account — writing to the wrong A&D book is unrecoverable.
 */
import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AccountConfig, ServerConfig } from "./config.js";
import type { ToolDef } from "./tools/types.js";
import { FastBoundClient, type ClientOptions } from "./client.js";

export class AccountRegistry {
  private readonly byAlias = new Map<string, AccountConfig>();
  private readonly byNumber = new Map<string, AccountConfig>();
  private readonly clients = new Map<string, FastBoundClient>();
  private readonly clientOpts: ClientOptions;
  private activeAlias: string;

  constructor(config: ServerConfig, clientOpts: ClientOptions = {}) {
    for (const account of config.accounts) {
      this.byAlias.set(account.alias, account);
      // First alias wins if two aliases point at the same account number.
      if (!this.byNumber.has(account.accountNumber)) this.byNumber.set(account.accountNumber, account);
    }
    this.clientOpts = clientOpts;
    this.activeAlias = config.defaultAlias;
  }

  list(): AccountConfig[] {
    return [...this.byAlias.values()];
  }

  get active(): AccountConfig {
    return this.byAlias.get(this.activeAlias)!;
  }

  /** Resolve an `account` argument. Undefined/blank → the active account. Throws on unknown. */
  resolve(ref?: string): AccountConfig {
    const key = ref?.trim().toLowerCase();
    if (!key) return this.active;
    const found = this.byAlias.get(key) ?? this.byNumber.get(key);
    if (!found) {
      throw new Error(
        `Unknown account "${ref}". Configured accounts: ${this.list()
          .map((a) => `${a.alias} (#${a.accountNumber})`)
          .join(", ")}. Nothing was sent.`,
      );
    }
    return found;
  }

  /** Move the active account. Returns the newly active account. */
  use(ref: string): AccountConfig {
    const account = this.resolve(ref);
    this.activeAlias = account.alias;
    return account;
  }

  /** One client per account, created on first use and reused (keeps its own throttle). */
  client(account: AccountConfig): FastBoundClient {
    let client = this.clients.get(account.alias);
    if (!client) {
      client = new FastBoundClient(account, this.clientOpts);
      this.clients.set(account.alias, client);
    }
    return client;
  }

  isActive(account: AccountConfig): boolean {
    return account.alias === this.activeAlias;
  }
}

/** Short identity tag used in tool results, e.g. "main #10001". */
export function accountTag(account: AccountConfig): string {
  return `${account.alias} #${account.accountNumber}`;
}

const ACCOUNT_ARG = z
  .string()
  .optional()
  .describe(
    "Which configured FastBound account to use for this one call — an alias or account number (see list_accounts). Omit to use the active account.",
  );

/** Every API tool accepts `account`; server-local tools (list_accounts/use_account) do not. */
export function schemaFor(tool: ToolDef): ZodRawShape {
  if (tool.local) return tool.inputSchema;
  if ("account" in tool.inputSchema) {
    throw new Error(
      `Tool ${tool.name} defines its own "account" argument, which collides with the injected one.`,
    );
  }
  return { ...tool.inputSchema, account: ACCOUNT_ARG };
}

const STATUS_TAG = /^(OK|DRY RUN|BLOCKED|ERROR)\b/;

/** Stamp the account a call hit into its first line, right after the status tag. */
export function tagResult(result: CallToolResult, account: AccountConfig): CallToolResult {
  const content = result.content ?? [];
  const first = content[0];
  if (!first || first.type !== "text") return result;
  const tag = `[${accountTag(account)}]`;
  const text = STATUS_TAG.test(first.text)
    ? first.text.replace(STATUS_TAG, `$1 ${tag}`)
    : `${tag} ${first.text}`;
  return { ...result, content: [{ ...first, text }, ...content.slice(1)] };
}
