/**
 * Contact field schemas, shared by create_contact, update_contact, and the inline
 * `contact` object embeddable in acquire/dispose.
 *
 * One schema serves all three contact kinds (FFL, organization, individual): supply
 * fflNumber for an FFL, organizationName for an org, or first/last name for an
 * individual, plus premise address fields.
 */
import { z } from "zod";

export const contactBody = {
  externalId: z.string().optional(),
  fflNumber: z.string().optional().describe("FFL number, e.g. 1-23-456-78-9A-12345 (for FFL contacts)."),
  fflExpires: z.string().optional().describe("FFL expiration date (ISO)."),
  lookupFFL: z.boolean().optional().describe("If true, FastBound auto-fills FFL details from the number."),
  licenseName: z.string().optional(),
  tradeName: z.string().optional(),
  sotein: z.string().optional(),
  sotClass: z.enum(["Importer", "Manufacturer", "Dealer"]).optional(),
  businessType: z.enum(["SoleProprietor", "Partnership", "Corporation"]).optional(),
  organizationName: z.string().optional().describe("For organization contacts."),
  firstName: z.string().optional().describe("For individual contacts."),
  middleName: z.string().optional(),
  lastName: z.string().optional().describe("For individual contacts."),
  suffix: z.string().optional(),
  premiseAddress1: z.string().optional(),
  premiseAddress2: z.string().optional(),
  premiseCity: z.string().optional(),
  premiseCounty: z.string().optional(),
  premiseState: z.string().optional().describe("2-letter state code."),
  premiseZipCode: z.string().optional(),
  premiseCountry: z.string().optional(),
  phoneNumber: z.string().optional(),
  fax: z.string().optional(),
  emailAddress: z.string().optional(),
};

/** An inline contact object (all fields optional) for embedding in acquire/dispose. */
export const contactObject = z.object(contactBody);

/** Extra fields editable only on update_contact (PUT /Contacts/{id}). */
export const editContactExtra = {
  status: z
    .enum(["Approved", "Caution", "Denied"])
    .optional()
    .describe("Compliance status. Merged from the existing contact if omitted."),
  statusNote: z.string().optional(),
  isArchived: z.boolean().optional(),
};

export const licenseBody = {
  type: z.string().describe("License type (required). See list_smartlists LicenseType."),
  number: z.string().describe("License number (required)."),
  expiration: z.string().optional().describe("License expiration date (ISO)."),
  copyOnFile: z.boolean().optional(),
};

export const mergeBody = {
  winningContactId: z.string().describe("GUID of the contact to KEEP."),
  losingContactId: z.string().describe("GUID of the contact to merge away and discard."),
};
