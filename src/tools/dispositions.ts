/**
 * Dispositions (firearm out / sale / transfer / theft-loss / destroyed / NFA) tools —
 * read and write.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import { pagination, lookupArgs, lookupPath, auditUserArg, confirmFlag } from "../schemas/common.js";
import {
  disposeShape,
  pendingDispositionShape,
  addDispositionItemsShape,
  theftLossShape,
  destroyedShape,
  nfaShape,
} from "../schemas/dispositions.js";
import { writeHandler, stripControl } from "./run.js";
import type { DispositionsList } from "../types.js";

// ---- Reads ----------------------------------------------------------------

const searchDispositions: ToolDef = {
  name: "search_dispositions",
  title: "Search dispositions",
  description:
    "Search disposition records (firearms leaving inventory: sales, FFL transfers, theft/loss, destroyed). Filter by type, TTSN/OTSN, PO/invoice/tracking, recipient contact, item. Read-only.",
  inputSchema: {
    id: z.string().optional(),
    externalId: z.string().optional(),
    type: z.string().optional(),
    TTSN: z.string().optional(),
    OTSN: z.string().optional(),
    include4473: z.boolean().optional().describe("Include linked 4473 info in results."),
    purchaseOrderNumber: z.string().optional(),
    invoiceNumber: z.string().optional(),
    shipmentTrackingNumber: z.string().optional(),
    isManufacturingDisposition: z.boolean().optional(),
    disposedToContactId: z.string().optional(),
    disposedToContactExternalId: z.string().optional(),
    itemId: z.string().optional(),
    itemExternalId: z.string().optional(),
    ...pagination,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<DispositionsList>("/Dispositions", args);
    return listResult("dispositions", data.dispositions ?? [], data.records);
  },
};

const getDisposition: ToolDef = {
  name: "get_disposition",
  title: "Get disposition",
  description: "Retrieve a single disposition by FastBound GUID id or your externalId. Read-only.",
  inputSchema: { ...lookupArgs },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const disp = await ctx.client.get(lookupPath("/Dispositions", args));
    return okResult(`disposition ${args.id}`, disp);
  },
};

const list4473Dispositions: ToolDef = {
  name: "list_4473_dispositions",
  title: "List 4473 dispositions",
  description: "List dispositions that have an associated ATF Form 4473. Read-only.",
  inputSchema: { ...pagination },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<DispositionsList>("/Dispositions/Only4473s", args);
    return listResult("4473 dispositions", data.dispositions ?? [], data.records);
  },
};

// ---- Writes ---------------------------------------------------------------

const dispose: ToolDef = {
  name: "dispose",
  title: "Dispose (create + commit)",
  description:
    "Record a disposition and commit it in one step (sale, FFL transfer, etc.). Items reference firearms already in inventory by GUID. For FFL transfers set requestType=Regular and otherTransfereeEmails; FastBound may auto-create the receiving FFL's acquisition (reported back via headers). Commits a regulated record: dry-run by default, pass confirm:true. Write.",
  inputSchema: { ...disposeShape, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Dispositions/CreateAndCommit",
      body: stripControl(args),
      summary: `Dispose ${args.items?.length ?? 0} firearm(s) (${args.requestType}) — create + commit.`,
    }),
  }),
};

const createPendingDisposition: ToolDef = {
  name: "create_pending_disposition",
  title: "Create pending disposition",
  description:
    "Create a PENDING (uncommitted) disposition draft. No ATF effect until committed, so it executes directly. Add items with add_disposition_items, then finalise with commit_disposition. Write.",
  inputSchema: { ...pendingDispositionShape, ...auditUserArg },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "POST",
      path: "/Dispositions/CreateAsPending",
      body: stripControl(args),
      summary: "Create a pending disposition draft.",
    }),
  }),
};

const addDispositionItems: ToolDef = {
  name: "add_disposition_items",
  title: "Add items to disposition",
  description:
    "Add inventory items (by GUID, optionally with a price) to a pending disposition. Executes directly. Write.",
  inputSchema: {
    dispositionId: z.string().min(1).describe("GUID of the pending disposition."),
    ...addDispositionItemsShape,
    ...auditUserArg,
  },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "POST",
      path: `/Dispositions/${encodeURIComponent(args.dispositionId)}/Items`,
      body: { items: args.items },
      summary: `Add ${args.items?.length ?? 0} item(s) to disposition ${args.dispositionId}.`,
    }),
  }),
};

const removeDispositionItems: ToolDef = {
  name: "remove_disposition_items",
  title: "Remove item from disposition",
  description:
    "Remove an item from a pending disposition by its inventory item GUID. Dry-run by default; pass confirm:true. Write.",
  inputSchema: {
    dispositionId: z.string().min(1).describe("GUID of the pending disposition."),
    itemId: z.string().min(1).describe("GUID of the inventory item to remove from the disposition."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: true },
  handler: writeHandler<{ dispositionId: string; itemId: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "DELETE",
      path: `/Dispositions/${encodeURIComponent(args.dispositionId)}/Items/Remove/${encodeURIComponent(args.itemId)}`,
      summary: `Remove item ${args.itemId} from disposition ${args.dispositionId}.`,
    }),
  }),
};

const commitDisposition: ToolDef = {
  name: "commit_disposition",
  title: "Commit disposition",
  description:
    "Commit a pending disposition to the A&D book — the point of no return. May trigger a Multiple Sale report and, for FFL transfers, auto-create the recipient's acquisition (reported via headers). Dry-run by default; pass confirm:true. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the pending disposition to commit."),
    otherTransfereeEmails: z
      .array(z.string())
      .optional()
      .describe("Recipient FFL user emails for an FFL transfer."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false },
  handler: writeHandler<{ id: string; otherTransfereeEmails?: string[]; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: `/Dispositions/${encodeURIComponent(args.id)}/Commit`,
      body: args.otherTransfereeEmails ? { otherTransfereeEmails: args.otherTransfereeEmails } : undefined,
      summary: `Commit disposition ${args.id} to the A&D book.`,
    }),
  }),
};

const lockDisposition: ToolDef = {
  name: "lock_disposition",
  title: "Lock disposition",
  description:
    "Lock a disposition to prevent further edits. Dry-run by default; pass confirm:true. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the disposition to lock."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<{ id: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "PUT",
      path: `/Dispositions/Lock/${encodeURIComponent(args.id)}`,
      summary: `Lock disposition ${args.id}.`,
    }),
  }),
};

const disposeTheftLoss: ToolDef = {
  name: "dispose_theft_loss",
  title: "Dispose as theft/loss",
  description:
    "Record and commit a theft/loss disposition for inventory items. Provide discovery date and incident numbers. Dry-run by default; pass confirm:true. Write.",
  inputSchema: { ...theftLossShape, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Dispositions/CreateAndCommit",
      body: { requestType: "TheftLoss", ...stripControl(args) },
      summary: `Report theft/loss of ${args.items?.length ?? 0} firearm(s).`,
    }),
  }),
};

const disposeDestroyed: ToolDef = {
  name: "dispose_destroyed",
  title: "Dispose as destroyed",
  description:
    "Record and commit a destroyed disposition for inventory items. Provide destruction date, description, and witnesses. Dry-run by default; pass confirm:true. Write.",
  inputSchema: { ...destroyedShape, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Dispositions/CreateAndCommit",
      body: { requestType: "Destroyed", ...stripControl(args) },
      summary: `Record destruction of ${args.items?.length ?? 0} firearm(s).`,
    }),
  }),
};

const disposeNfa: ToolDef = {
  name: "dispose_nfa",
  title: "Dispose (NFA)",
  description:
    "Record and commit an NFA disposition for inventory items. Dry-run by default; pass confirm:true. Write.",
  inputSchema: { ...nfaShape, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Dispositions/CreateAndCommit",
      body: { requestType: "NFA", ...stripControl(args) },
      summary: `NFA disposition of ${args.items?.length ?? 0} firearm(s).`,
    }),
  }),
};

export const dispositionTools: ToolDef[] = [
  searchDispositions,
  getDisposition,
  list4473Dispositions,
  dispose,
  createPendingDisposition,
  addDispositionItems,
  removeDispositionItems,
  commitDisposition,
  lockDisposition,
  disposeTheftLoss,
  disposeDestroyed,
  disposeNfa,
];
