/**
 * Disposition request schemas: the general CreateAndCommit (dispose) plus the
 * specialised theft/loss, destroyed, and NFA variants.
 *
 * Disposition items reference firearms ALREADY in inventory by their FastBound GUID
 * (optionally with a sale price) — you dispose existing items, you don't describe new ones.
 */
import { z } from "zod";
import { contactObject } from "./contacts.js";

export const dispositionItemRef = z.object({
  id: z.string().describe("FastBound GUID of the inventory item to dispose."),
  price: z.number().optional().describe("Sale price for this item."),
});

const recipientRef = {
  contactId: z.string().optional().describe("Existing recipient/buyer contact GUID."),
  contactExternalId: z.string().optional(),
  contact: contactObject.optional().describe("Inline new recipient contact (alternative to contactId)."),
};

/** dispose: create + commit. requestType + date required. */
export const disposeShape = {
  requestType: z
    .enum(["Regular", "Manufacturing", "NFA", "TheftLoss", "Destroyed"])
    .describe("Disposition request type. Use Regular for sales/FFL transfers."),
  date: z.string().describe("Disposition date (ISO, required) — when the firearm left the premises."),
  items: z.array(dispositionItemRef).min(1).describe("Inventory items being disposed."),
  type: z.string().optional().describe("Disposition type label. See list_smartlists DisposeType."),
  note: z.string().optional(),
  ttsn: z.string().optional(),
  generateTTSN: z.boolean().optional().describe("Have FastBound generate the TTSN."),
  otsn: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  shipmentTrackingNumber: z.string().optional(),
  otherTransfereeEmails: z
    .array(z.string())
    .optional()
    .describe("Recipient FFL user emails for an FFL transfer; FastBound notifies them and may auto-create their acquisition."),
  ...recipientRef,
};

/** create_pending_disposition: items optional (add later, then commit). */
export const pendingDispositionShape = {
  requestType: z.enum(["Regular", "Manufacturing", "NFA", "TheftLoss", "Destroyed"]),
  date: z.string().describe("Disposition date (ISO, required)."),
  items: z.array(dispositionItemRef).optional(),
  type: z.string().optional(),
  note: z.string().optional(),
  ttsn: z.string().optional(),
  generateTTSN: z.boolean().optional(),
  otsn: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  shipmentTrackingNumber: z.string().optional(),
  otherTransfereeEmails: z.array(z.string()).optional(),
  ...recipientRef,
};

// The specialised dispositions below are one-shot CreateAndCommit calls: the tool
// fixes requestType and the handler routes them to /Dispositions/CreateAndCommit
// with their type-specific fields plus the items being disposed.

export const theftLossShape = {
  items: z.array(dispositionItemRef).min(1).describe("Inventory items reported stolen/lost."),
  date: z.string().describe("Disposition date (ISO, required)."),
  externalId: z.string().optional(),
  note: z.string().optional(),
  theftLoss_DiscoveredDate: z.string().optional().describe("When the theft/loss was discovered (ISO)."),
  theftLoss_Type: z.string().optional().describe("See list_smartlists TheftLossType."),
  theftLoss_ATFIssuedIncidentNumber: z.string().optional(),
  theftLoss_PoliceIncidentNumber: z.string().optional(),
};

export const destroyedShape = {
  items: z.array(dispositionItemRef).min(1).describe("Inventory items destroyed."),
  date: z.string().describe("Disposition date (ISO, required)."),
  externalId: z.string().optional(),
  note: z.string().optional(),
  destroyed_Date: z.string().optional(),
  destroyed_Description: z.string().optional(),
  destroyed_Witness1: z.string().optional(),
  destroyed_Witness2: z.string().optional(),
};

export const nfaShape = {
  items: z.array(dispositionItemRef).min(1).describe("Inventory items in the NFA disposition."),
  type: z.string().describe("NFA disposition type (required). See list_smartlists DisposeType."),
  date: z.string().describe("Disposition date (ISO, required)."),
  submissionDate: z.string().optional(),
  externalId: z.string().optional(),
  note: z.string().optional(),
  ttsn: z.string().optional(),
  generateTTSN: z.boolean().optional(),
  otsn: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  shipmentTrackingNumber: z.string().optional(),
  ...recipientRef,
};

/** add_disposition_items: reference existing items by GUID (+ optional price). */
export const addDispositionItemsShape = {
  items: z.array(dispositionItemRef).min(1).describe("Inventory items (by GUID) to add to a pending disposition."),
};
