/**
 * Acquisition request schemas (acquire = CreateAndCommit, and the staged variant).
 */
import { z } from "zod";
import { acquisitionItem } from "./items.js";
import { contactObject } from "./contacts.js";

/** Supplier contact: reference an existing one OR embed a new one. */
const contactRef = {
  contactId: z.string().optional().describe("Existing supplier contact GUID."),
  contactExternalId: z.string().optional().describe("Existing supplier contact externalId."),
  contact: contactObject.optional().describe("Inline new supplier contact (alternative to contactId)."),
};

const acquisitionCore = {
  type: z.string().describe("Acquisition type (required). See list_smartlists AcquireType."),
  date: z.string().optional().describe("Acquisition date (ISO). Defaults to now if omitted."),
  isManufacturingAcquisition: z.boolean().optional().describe("FFL type 07/10 manufacturing only."),
  note: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  shipmentTrackingNumber: z.string().optional(),
  externalId: z.string().optional(),
  ...contactRef,
};

/** acquire: create + commit in one call. Items required. */
export const acquireShape = {
  ...acquisitionCore,
  items: z.array(acquisitionItem).min(1).describe("Firearms being acquired into the A&D book."),
};

/** create_pending_acquisition: items optional (add later, then commit). */
export const pendingAcquisitionShape = {
  ...acquisitionCore,
  items: z.array(acquisitionItem).optional(),
};

/** add_acquisition_items: one firearm per call onto a pending acquisition. */
export const acquisitionItemShape = acquisitionItem.shape;
