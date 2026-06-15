/**
 * Inventory bulk-verify (cycle count). Marks serials as physically verified and can
 * optionally update their location. Executes directly once writes are enabled.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { auditUserArg } from "../schemas/common.js";
import { writeHandler, stripControl } from "./run.js";

const bulkVerifyInventory: ToolDef = {
  name: "bulk_verify_inventory",
  title: "Bulk verify inventory",
  description:
    "Mark a list of serial numbers as physically verified during a cycle count, optionally updating their location. Write.",
  inputSchema: {
    serials: z.array(z.string()).min(1).describe("Serial numbers to verify."),
    rollbackPartial: z.boolean().optional().describe("If true, roll back all changes when any serial fails."),
    updateLocation: z.boolean().optional().describe("If true, set the location of verified items."),
    location: z.string().optional().describe("Location to set when updateLocation is true."),
    verifiedUtc: z.string().optional().describe("Verification timestamp (ISO UTC); defaults to now."),
    ...auditUserArg,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "PUT",
      path: "/Inventory/BulkVerify",
      body: stripControl(args),
      summary: `Verify ${args.serials?.length ?? 0} serial(s).`,
    }),
  }),
};

export const inventoryTools: ToolDef[] = [bulkVerifyInventory];
