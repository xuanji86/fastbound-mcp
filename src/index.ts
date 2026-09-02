#!/usr/bin/env node
/**
 * FastBound MCP server — entry point.
 *
 * Wires the tool registry onto an McpServer over stdio. Kept intentionally thin:
 * all behaviour lives in config/accounts/client/writeGuard/tools so this file does
 * not grow with the tool count.
 *
 * Multi-account plumbing lives here because it is uniform: every API tool gets an
 * optional `account` argument injected, the argument is resolved (and stripped, so
 * it never reaches a request body) before the handler runs, and every result is
 * tagged with the account it actually hit.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./envFile.js";
import { loadConfig, type AccountConfig } from "./config.js";
import { AccountRegistry, accountTag, schemaFor, tagResult } from "./accounts.js";
import { FastBoundApiError, formatApiError } from "./errors.js";
import { errorResult } from "./result.js";
import type { ToolContext } from "./writeGuard.js";
import type { ToolDef } from "./tools/index.js";
import { allTools, assertUniqueToolNames } from "./tools/index.js";

/** Run a tool handler, converting thrown API/validation errors into clean ERROR results. */
async function invoke(tool: ToolDef, args: unknown, ctx: ToolContext) {
  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    if (err instanceof FastBoundApiError) return errorResult(formatApiError(err));
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

async function main(): Promise<void> {
  loadEnvFile(); // .env -> process.env before any credential is read; no shell wrapper needed
  const config = loadConfig(); // throws on missing creds → fatal before connecting
  const registry = new AccountRegistry(config);

  assertUniqueToolNames();

  const server = new McpServer({ name: "fastbound-mcp", version: "0.2.0" });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: schemaFor(tool),
        annotations: tool.annotations,
      },
      async (args: unknown): Promise<CallToolResult> => {
        const { account: ref, ...rest } = (args ?? {}) as Record<string, unknown>;
        let account: AccountConfig;
        try {
          // Local tools act on the registry itself and keep their own `account` arg.
          account = tool.local ? registry.active : registry.resolve(ref as string | undefined);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
        const ctx: ToolContext = { client: registry.client(account), config: account, accounts: registry };
        if (tool.local) return invoke(tool, args, ctx);
        return tagResult(await invoke(tool, rest, ctx), account);
      },
    );
  }

  console.error(
    `[fastbound-mcp] accounts: ${registry
      .list()
      .map(
        (a) =>
          `${accountTag(a)}${registry.isActive(a) ? " (active)" : ""} writes=${a.allowWrites ? "on" : "off"}`,
      )
      .join(", ")}`,
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // Never leak secrets; surface a terse fatal line on stderr (stdout is the MCP channel).
  console.error(`[fastbound-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
