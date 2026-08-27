/**
 * Tool descriptor used by the registry. Each resource-group file exports a
 * `ToolDef[]`; tools/index.ts concatenates them; index.ts registers them in one loop.
 */
import type { ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../writeGuard.js";

export type { ToolContext };

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations?: ToolAnnotations;
  /**
   * true → the tool only touches server-local state (the account registry), so it gets
   * no injected `account` argument and its result carries no account tag.
   */
  local?: boolean;
  /** Receives args already validated against inputSchema by the MCP SDK. */
  handler: (args: any, ctx: ToolContext) => Promise<CallToolResult>;
}
