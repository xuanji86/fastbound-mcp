/**
 * Tool registry: concatenate every resource group's ToolDef[] into a flat list.
 * Adding a tool means adding a ToolDef to its group array — index.ts never changes.
 */
import type { ToolDef } from "./types.js";
import { accountTools } from "./account.js";
import { itemTools } from "./items.js";
import { acquisitionTools } from "./acquisitions.js";
import { dispositionTools } from "./dispositions.js";
import { contactTools } from "./contacts.js";
import { reportTools } from "./reports.js";
import { webhookTools } from "./webhooks.js";
import { inventoryTools } from "./inventory.js";

export const allTools: ToolDef[] = [
  ...accountTools,
  ...itemTools,
  ...acquisitionTools,
  ...dispositionTools,
  ...contactTools,
  ...reportTools,
  ...webhookTools,
  ...inventoryTools,
];

/** Fail fast on duplicate tool names (a copy-paste hazard with many groups). */
export function assertUniqueToolNames(tools: ToolDef[] = allTools): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    seen.add(t.name);
  }
}

export type { ToolDef };
