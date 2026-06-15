/**
 * Webhook subscription management. One tool with an `action`: reads (list_events, get)
 * run directly; mutations (create, update, delete) go through the write guard. Webhooks
 * are infrastructure config (not A&D records), so mutations execute directly once
 * writes are enabled (no dry-run/confirm).
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult } from "../result.js";
import { auditUserArg } from "../schemas/common.js";
import { writeHandler } from "./run.js";
import type { ToolContext } from "../writeGuard.js";

const webhookWrite = writeHandler<any>({
  dryRunnable: false,
  describe: (args) => {
    if (args.action === "create") {
      if (!args.name || !args.url || !args.events?.length) {
        throw new Error("create requires `name`, `url`, and at least one `events` entry.");
      }
      return {
        method: "POST",
        path: "/Webhooks",
        body: { name: args.name, url: args.url, description: args.description, events: args.events },
        summary: `Create webhook "${args.name}".`,
      };
    }
    if (!args.name) throw new Error(`${args.action} requires \`name\`.`);
    if (args.action === "update") {
      return {
        method: "PUT",
        path: `/Webhooks/${encodeURIComponent(args.name)}`,
        body: { name: args.name, url: args.url, description: args.description, events: args.events },
        summary: `Update webhook "${args.name}".`,
      };
    }
    return {
      method: "DELETE",
      path: `/Webhooks/${encodeURIComponent(args.name)}`,
      summary: `Delete webhook "${args.name}".`,
    };
  },
});

const manageWebhooks: ToolDef = {
  name: "manage_webhooks",
  title: "Manage webhooks",
  description:
    "List available webhook event types, get a webhook, or create/update/delete a webhook subscription. action=list_events|get reads; create|update|delete are writes (require FASTBOUND_ALLOW_WRITES). For create provide name, url, and events.",
  inputSchema: {
    action: z.enum(["list_events", "get", "create", "update", "delete"]),
    name: z.string().optional().describe("Webhook name (required for get/create/update/delete)."),
    url: z.string().optional().describe("HTTPS endpoint URL (for create/update)."),
    description: z.string().optional(),
    events: z.array(z.string()).optional().describe("Event names to subscribe to (see action=list_events)."),
    ...auditUserArg,
  },
  annotations: { openWorldHint: true },
  handler: async (args, ctx: ToolContext) => {
    if (args.action === "list_events") {
      return okResult("webhook event types", await ctx.client.get("/Webhooks/Events"));
    }
    if (args.action === "get") {
      if (!args.name) throw new Error("get requires `name`.");
      return okResult(`webhook ${args.name}`, await ctx.client.get(`/Webhooks/${encodeURIComponent(args.name)}`));
    }
    return webhookWrite(args, ctx);
  },
};

export const webhookTools: ToolDef[] = [manageWebhooks];
