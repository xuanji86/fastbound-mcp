/**
 * Item field schemas: the firearm shape used when acquiring, and the editable
 * fields for update_item.
 *
 * Firearm classification fields (manufacturer/caliber/type/condition/location) are
 * free strings pointing to list_smartlists — those lists are account-configurable,
 * so hard-coding enums would reject valid values.
 */
import { z } from "zod";

/** A firearm being acquired (acquire, create_pending_acquisition, add_acquisition_items). */
export const acquisitionItem = z.object({
  manufacturer: z.string().describe("Required. See list_smartlists Manufacturer."),
  model: z.string().describe("Required."),
  serial: z.string().describe("Required. The serial marked on the firearm."),
  caliber: z.string().describe("Required. See list_smartlists Caliber."),
  type: z.string().describe("Required. See list_smartlists ItemType."),
  importer: z.string().optional().describe("Required for imported firearms."),
  countryOfManufacture: z.string().optional(),
  barrelLength: z.number().optional(),
  totalLength: z.number().optional(),
  itemNumber: z.string().optional(),
  condition: z.string().optional().describe("See list_smartlists Condition."),
  cost: z.string().optional(),
  price: z.string().optional(),
  mpn: z.string().optional(),
  upc: z.string().optional(),
  sku: z.string().optional(),
  location: z.string().optional().describe("See list_smartlists Location."),
  note: z.string().optional(),
  externalId: z.string().optional(),
});

/**
 * Editable fields for update_item (PUT /Items/{id}). All optional: update_item does a
 * GET-merge-PUT, so required fields the API expects (itemNumber, manufacturer, serial,
 * model, caliber, type, acquire_Date, acquisitionType) are carried over from the
 * existing record when not supplied.
 */
export const editItemShape = {
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serial: z.string().optional(),
  caliber: z.string().optional(),
  type: z.string().optional(),
  itemNumber: z.string().optional(),
  importer: z.string().optional(),
  countryOfManufacture: z.string().optional(),
  barrelLength: z.number().optional(),
  totalLength: z.number().optional(),
  condition: z.string().optional(),
  cost: z.string().optional(),
  price: z.string().optional(),
  mpn: z.string().optional(),
  upc: z.string().optional(),
  sku: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional(),
  doNotDispose: z.boolean().optional(),
  externalId: z.string().optional(),
  acquisitionType: z.string().optional(),
  acquire_Date: z.string().optional(),
  acquire_PurchaseOrderNumber: z.string().optional(),
  acquire_InvoiceNumber: z.string().optional(),
  acquire_ShipmentTrackingNumber: z.string().optional(),
};

export const deleteItemBody = {
  deleteType: z
    .string()
    .describe("Why the item is being deleted (required). See list_smartlists DeleteType — typically Duplicate or Error."),
  deleteNote: z.string().describe("Required note explaining the deletion (immutable audit trail)."),
};
