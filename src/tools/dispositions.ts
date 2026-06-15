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
import { writeHandler, stripControl, bodyWithout, mergeFields } from "./run.js";
import type { ToolContext } from "../writeGuard.js";
import type { DispositionsList } from "../types.js";

const EDIT_DISPOSITION_FIELDS = [
  "externalId",
  "date",
  "submissionDate",
  "type",
  "note",
  "ttsn",
  "generateTTSN",
  "otsn",
  "purchaseOrderNumber",
  "invoiceNumber",
  "shipmentTrackingNumber",
  "theftLoss_DiscoveredDate",
  "theftLoss_Type",
  "theftLoss_ATFIssuedIncidentNumber",
  "theftLoss_PoliceIncidentNumber",
  "destroyed_Date",
  "destroyed_Description",
  "destroyed_Witness1",
  "destroyed_Witness2",
] as const;

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

const listDispositionItems: ToolDef = {
  name: "list_disposition_items",
  title: "List disposition items",
  description: "List the items on a disposition. Read-only.",
  inputSchema: { id: z.string().min(1).describe("GUID of the disposition.") },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<{ items?: unknown[] }>(
      `/Dispositions/${encodeURIComponent(args.id)}/Items`,
    );
    return okResult(`items on disposition ${args.id}`, data);
  },
};

const updateDisposition: ToolDef = {
  name: "update_disposition",
  title: "Update disposition",
  description:
    "Edit header fields on a PENDING disposition (type, date, note, TTSN/OTSN, PO/invoice/tracking, theft-loss/destroyed details). Read-merge-write so unspecified fields keep their values. Dry-run by default; pass confirm:true. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the pending disposition."),
    type: z.string().optional().describe("Disposition type (see list_smartlists DisposeType)."),
    date: z.string().optional(),
    submissionDate: z.string().optional(),
    note: z.string().optional(),
    externalId: z.string().optional(),
    ttsn: z.string().optional(),
    generateTTSN: z.boolean().optional(),
    otsn: z.string().optional(),
    purchaseOrderNumber: z.string().optional(),
    invoiceNumber: z.string().optional(),
    shipmentTrackingNumber: z.string().optional(),
    theftLoss_DiscoveredDate: z.string().optional(),
    theftLoss_Type: z.string().optional(),
    theftLoss_ATFIssuedIncidentNumber: z.string().optional(),
    theftLoss_PoliceIncidentNumber: z.string().optional(),
    destroyed_Date: z.string().optional(),
    destroyed_Description: z.string().optional(),
    destroyed_Witness1: z.string().optional(),
    destroyed_Witness2: z.string().optional(),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: async (args, ctx: ToolContext) => {
      const current = await ctx.client.get<Record<string, unknown>>(
        `/Dispositions/${encodeURIComponent(args.id)}`,
      );
      const changes = bodyWithout(args, ["id"]);
      return {
        method: "PUT",
        path: `/Dispositions/${encodeURIComponent(args.id)}`,
        body: mergeFields(current, changes, EDIT_DISPOSITION_FIELDS),
        summary: `Update disposition ${args.id} (${Object.keys(changes).length} field(s) changed).`,
        previewNote: "a read of the current disposition was performed to compute the merged body",
      };
    },
  }),
};

const editDispositionItemPrice: ToolDef = {
  name: "edit_disposition_item_price",
  title: "Edit disposition item price",
  description: "Set the sale price of an item on a pending disposition. Executes directly. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the disposition."),
    itemId: z.string().min(1).describe("GUID of the inventory item on the disposition."),
    price: z.number().describe("New sale price."),
    ...auditUserArg,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<{ id: string; itemId: string; price: number; auditUser?: string }>({
    dryRunnable: false,
    describe: (args) => ({
      method: "PUT",
      path: `/Dispositions/${encodeURIComponent(args.id)}/Items/EditPrice/${encodeURIComponent(args.itemId)}`,
      body: { price: args.price },
      summary: `Set price of item ${args.itemId} on disposition ${args.id} to ${args.price}.`,
    }),
  }),
};

const attachDispositionContact: ToolDef = {
  name: "attach_disposition_contact",
  title: "Attach disposition contact",
  description:
    "Assign an existing recipient/buyer contact to a pending disposition. Executes directly. Write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the pending disposition."),
    contactId: z.string().min(1).describe("GUID of the recipient contact to attach."),
    ...auditUserArg,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<{ id: string; contactId: string; auditUser?: string }>({
    dryRunnable: false,
    describe: (args) => ({
      method: "PUT",
      path: `/Dispositions/${encodeURIComponent(args.id)}/AttachContact/${encodeURIComponent(args.contactId)}`,
      summary: `Attach contact ${args.contactId} to disposition ${args.id}.`,
    }),
  }),
};

const deleteDisposition: ToolDef = {
  name: "delete_disposition",
  title: "Delete pending disposition",
  description:
    "Delete a PENDING (uncommitted) disposition draft. Dry-run by default; pass confirm:true. Destructive write.",
  inputSchema: {
    id: z.string().min(1).describe("GUID of the pending disposition to delete."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: true },
  handler: writeHandler<{ id: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "DELETE",
      path: `/Dispositions/${encodeURIComponent(args.id)}`,
      summary: `Delete pending disposition ${args.id}.`,
    }),
  }),
};

export const dispositionTools: ToolDef[] = [
  searchDispositions,
  getDisposition,
  listDispositionItems,
  list4473Dispositions,
  dispose,
  createPendingDisposition,
  addDispositionItems,
  updateDisposition,
  editDispositionItemPrice,
  attachDispositionContact,
  removeDispositionItems,
  commitDisposition,
  lockDisposition,
  disposeTheftLoss,
  disposeDestroyed,
  disposeNfa,
  deleteDisposition,
];
