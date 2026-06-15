/**
 * Items (firearm inventory) tools — read and write.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import { pagination, lookupArgs, lookupPath, auditUserArg, confirmFlag } from "../schemas/common.js";
import { editItemShape, deleteItemBody } from "../schemas/items.js";
import { writeHandler, bodyWithout } from "./run.js";
import type { ToolContext } from "../writeGuard.js";
import type { ItemsList, FastBoundItem } from "../types.js";

// ---- Reads ----------------------------------------------------------------

const searchItems: ToolDef = {
  name: "search_items",
  title: "Search items",
  description:
    "Search the firearm inventory (the A&D book). Filter by serial, manufacturer, model, type, caliber, status, date ranges, TTSN/OTSN, and more. Returns a page of items plus the total record count. Read-only.",
  inputSchema: {
    search: z.string().optional().describe("Free-text search across item fields."),
    serial: z.string().optional(),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    importer: z.string().optional(),
    type: z.array(z.string()).optional().describe("One or more item types (see list_smartlists ItemType)."),
    caliber: z.string().optional(),
    location: z.string().optional(),
    condition: z.array(z.string()).optional(),
    itemNumber: z.string().optional(),
    mpn: z.string().optional(),
    upc: z.string().optional(),
    sku: z.string().optional(),
    ttsn: z.string().optional().describe("Transferee/Transferor transaction serial number."),
    otsn: z.string().optional(),
    status: z.string().optional().describe("Item status filter, e.g. open/disposed."),
    isTheftLoss: z.boolean().optional(),
    isDestroyed: z.boolean().optional(),
    doNotDispose: z.boolean().optional(),
    hasExternalId: z.boolean().optional(),
    dispositionId: z.string().optional(),
    acquisitionType: z.array(z.string()).optional(),
    acquiredOnOrAfter: z.string().optional().describe("ISO date lower bound for acquisition."),
    acquiredOnOrBefore: z.string().optional(),
    disposedOnOrAfter: z.string().optional(),
    disposedOnOrBefore: z.string().optional(),
    ...pagination,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<ItemsList>("/Items", args);
    return listResult("items", data.items ?? [], data.records);
  },
};

const getItem: ToolDef = {
  name: "get_item",
  title: "Get item",
  description:
    "Retrieve a single firearm record by FastBound GUID id or by your externalId. Read-only.",
  inputSchema: { ...lookupArgs },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const item = await ctx.client.get<FastBoundItem>(lookupPath("/Items", args));
    return okResult(`item ${args.id}`, item);
  },
};

// ---- Writes ---------------------------------------------------------------

/**
 * Build the full PUT /Items/{id} (EditItem) body by merging caller changes over the
 * current record. The API replaces the whole object, so every editable field must be
 * present — unchanged ones come from `current`. Maps the read model's `overallLength`
 * to the edit body's `totalLength` and coerces numeric cost/price to strings.
 */
function buildEditItemBody(
  current: FastBoundItem,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const pick = (key: keyof FastBoundItem & string): unknown =>
    key in changes ? changes[key] : current[key];
  const asString = (v: unknown): unknown => (typeof v === "number" ? String(v) : v);

  const body: Record<string, unknown> = {
    itemNumber: pick("itemNumber"),
    manufacturer: pick("manufacturer"),
    serial: pick("serial"),
    model: pick("model"),
    caliber: pick("caliber"),
    type: pick("type"),
    importer: pick("importer"),
    countryOfManufacture: pick("countryOfManufacture"),
    barrelLength: pick("barrelLength"),
    totalLength: "totalLength" in changes ? changes.totalLength : current.overallLength,
    condition: pick("condition"),
    cost: asString(pick("cost")),
    price: asString(pick("price")),
    mpn: pick("mpn"),
    upc: pick("upc"),
    sku: pick("sku"),
    location: pick("location"),
    note: "note" in changes ? changes.note : undefined,
    doNotDispose: pick("doNotDispose"),
    externalId: pick("externalId"),
    acquisitionType: pick("acquisitionType"),
    acquire_Date: pick("acquire_Date"),
    acquire_PurchaseOrderNumber: pick("acquire_PurchaseOrderNumber"),
    acquire_InvoiceNumber: pick("acquire_InvoiceNumber"),
    acquire_ShipmentTrackingNumber: pick("acquire_ShipmentTrackingNumber"),
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

interface UpdateItemArgs {
  id: string;
  auditUser?: string;
  confirm?: boolean;
  [key: string]: unknown;
}

const updateItem: ToolDef = {
  name: "update_item",
  title: "Update item",
  description:
    "Edit fields on an existing firearm record. Performs a read-merge-write so unspecified fields keep their current values. Dry-run by default (preview shows the merged body); pass confirm:true to apply. Write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the item to edit."),
    ...editItemShape,
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<UpdateItemArgs>({
    dryRunnable: true,
    describe: async (args, ctx: ToolContext) => {
      const current = await ctx.client.get<FastBoundItem>(`/Items/${encodeURIComponent(args.id)}`);
      const changes = bodyWithout(args, ["id"]);
      return {
        method: "PUT",
        path: `/Items/${encodeURIComponent(args.id)}`,
        body: buildEditItemBody(current, changes),
        summary: `Update item ${args.id} (${Object.keys(changes).length} field(s) changed).`,
        previewNote: "a read of the current item was performed to compute the merged body",
      };
    },
  }),
};

const setItemExternalId: ToolDef = {
  name: "set_item_external_id",
  title: "Set item externalId",
  description:
    "Set or change only the externalId of an item (links it to your system's record) without touching other fields. Write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the item."),
    externalId: z.string().describe("Your external identifier for this item."),
    ...auditUserArg,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<{ id: string; externalId: string; auditUser?: string }>({
    dryRunnable: false,
    describe: (args) => ({
      method: "PUT",
      path: `/Items/${encodeURIComponent(args.id)}/SetExternalId`,
      body: { externalId: args.externalId },
      summary: `Set externalId of item ${args.id} to "${args.externalId}".`,
    }),
  }),
};

const deleteItem: ToolDef = {
  name: "delete_item",
  title: "Delete item",
  description:
    "Delete a firearm record. ATF permits deletion only for a Duplicate or Error; a deleteType and an explanatory deleteNote are required and form an immutable audit entry. Dry-run by default; pass confirm:true to delete. Destructive write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the item to delete."),
    ...deleteItemBody,
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: true },
  handler: writeHandler<{ id: string; deleteType: string; deleteNote: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: `/Items/${encodeURIComponent(args.id)}/Delete`,
      body: { deleteType: args.deleteType, deleteNote: args.deleteNote },
      summary: `Delete item ${args.id} (${args.deleteType}).`,
    }),
  }),
};

const undisposeItem: ToolDef = {
  name: "undispose_item",
  title: "Undispose item",
  description:
    "Reverse a disposition: return a disposed firearm to available inventory. Dry-run by default; pass confirm:true to apply. Write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the disposed item."),
    note: z.string().optional().describe("Reason for undisposing."),
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: true },
  handler: writeHandler<{ id: string; note?: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "PUT",
      path: `/Items/${encodeURIComponent(args.id)}/Undispose`,
      body: { note: args.note },
      summary: `Undispose item ${args.id} (return to inventory).`,
    }),
  }),
};

const setItemAcquisitionContact: ToolDef = {
  name: "set_item_acquisition_contact",
  title: "Set item acquisition contact",
  description:
    "Set the acquisition (source) contact on an item. Executes directly. Write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the item."),
    contactId: z.string().min(1).describe("GUID of the acquisition/source contact."),
    ...auditUserArg,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<{ id: string; contactId: string; auditUser?: string }>({
    dryRunnable: false,
    describe: (args) => ({
      method: "PUT",
      path: `/Items/${encodeURIComponent(args.id)}/AcquisitionContact/${encodeURIComponent(args.contactId)}`,
      summary: `Set acquisition contact of item ${args.id} to ${args.contactId}.`,
    }),
  }),
};

export const itemTools: ToolDef[] = [
  searchItems,
  getItem,
  updateItem,
  setItemExternalId,
  setItemAcquisitionContact,
  deleteItem,
  undisposeItem,
];
