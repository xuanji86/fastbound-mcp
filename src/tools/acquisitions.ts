/**
 * Acquisitions (firearm intake) tools — read and write.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import { pagination, lookupArgs, lookupPath, auditUserArg, confirmFlag } from "../schemas/common.js";
import { acquireShape, pendingAcquisitionShape, acquisitionItemShape } from "../schemas/acquisitions.js";
import { writeHandler, stripControl, bodyWithout } from "./run.js";
import type { AcquisitionsList } from "../types.js";

// ---- Reads ----------------------------------------------------------------

const searchAcquisitions: ToolDef = {
  name: "search_acquisitions",
  title: "Search acquisitions",
  description:
    "Search acquisition records (intake events). Filter by type, PO/invoice/tracking number, supplier contact, item, and manufacturing flag. Read-only.",
  inputSchema: {
    id: z.string().optional(),
    externalId: z.string().optional(),
    type: z.string().optional(),
    purchaseOrderNumber: z.string().optional(),
    invoiceNumber: z.string().optional(),
    shipmentTrackingNumber: z.string().optional(),
    isManufacturingAcquisition: z.boolean().optional(),
    acquiredFromContactId: z.string().optional(),
    acquiredFromContactExternalId: z.string().optional(),
    itemId: z.string().optional(),
    itemExternalId: z.string().optional(),
    ...pagination,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<AcquisitionsList>("/Acquisitions", args);
    return listResult("acquisitions", data.acquisitions ?? [], data.records);
  },
};

const getAcquisition: ToolDef = {
  name: "get_acquisition",
  title: "Get acquisition",
  description: "Retrieve a single acquisition by FastBound GUID id or your externalId. Read-only.",
  inputSchema: { ...lookupArgs },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const acq = await ctx.client.get(lookupPath("/Acquisitions", args));
    return okResult(`acquisition ${args.id}`, acq);
  },
};

// ---- Writes ---------------------------------------------------------------

const acquire: ToolDef = {
  name: "acquire",
  title: "Acquire (create + commit)",
  description:
    "Record an acquisition and commit it to the A&D book in one step (the recommended intake path). A supplier contact is REQUIRED — provide contactId, contactExternalId, or an inline contact. This commits a regulated record: dry-run by default, pass confirm:true to execute. Write.",
  inputSchema: { ...acquireShape, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Acquisitions/CreateAndCommit",
      body: stripControl(args),
      summary: `Acquire ${args.items?.length ?? 0} firearm(s) into the A&D book (create + commit).`,
    }),
  }),
};

const createPendingAcquisition: ToolDef = {
  name: "create_pending_acquisition",
  title: "Create pending acquisition",
  description:
    "Create a PENDING (uncommitted) acquisition draft. A supplier contact is REQUIRED (contactId, contactExternalId, or inline contact). Has no ATF effect until committed, so it executes directly (no dry-run). Add items with add_acquisition_items, then finalise with commit_acquisition. Write.",
  inputSchema: { ...pendingAcquisitionShape, ...auditUserArg },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "POST",
      path: "/Acquisitions/CreateAsPending",
      body: stripControl(args),
      summary: "Create a pending acquisition draft.",
    }),
  }),
};

const addAcquisitionItems: ToolDef = {
  name: "add_acquisition_items",
  title: "Add item to acquisition",
  description:
    "Add a single firearm to a pending acquisition. Executes directly (the acquisition is still uncommitted). Write.",
  inputSchema: {
    acquisitionId: z.string().min(1).describe("GUID of the pending acquisition."),
    ...acquisitionItemShape,
    ...auditUserArg,
  },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "POST",
      path: `/Acquisitions/${encodeURIComponent(args.acquisitionId)}/Items`,
      body: bodyWithout(args, ["acquisitionId"]),
      summary: `Add firearm ${args.serial} to acquisition ${args.acquisitionId}.`,
    }),
  }),
};

const commitAcquisition: ToolDef = {
  name: "commit_acquisition",
  title: "Commit acquisition",
  description:
    "Commit a pending acquisition to the A&D book — the point of no return. Dry-run by default; pass confirm:true to commit. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the pending acquisition to commit."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false },
  handler: writeHandler<{ id: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: `/Acquisitions/${encodeURIComponent(args.id)}/Commit`,
      summary: `Commit acquisition ${args.id} to the A&D book.`,
    }),
  }),
};

export const acquisitionTools: ToolDef[] = [
  searchAcquisitions,
  getAcquisition,
  acquire,
  createPendingAcquisition,
  addAcquisitionItems,
  commitAcquisition,
];
