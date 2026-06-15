#!/usr/bin/env node
/**
 * FastBound MCP server — entry point.
 *
 * Wires the tool registry onto an McpServer over stdio. Kept intentionally thin:
 * all behaviour lives in config/client/writeGuard/tools so this file does not grow
 * with the tool count.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FastBoundClient } from "./client.js";
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
  const config = loadConfig(); // throws on missing creds → fatal before connecting
  const client = new FastBoundClient(config);
  const ctx: ToolContext = { client, config };

  assertUniqueToolNames();

  const server = new McpServer({ name: "fastbound-mcp", version: "0.1.0" });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args: unknown) => invoke(tool, args, ctx),
    );
  }

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // Never leak secrets; surface a terse fatal line on stderr (stdout is the MCP channel).
  console.error(`[fastbound-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
