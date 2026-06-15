/**
 * Contacts (suppliers, buyers, FFLs) tools — read and write.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import { pagination, lookupArgs, lookupPath, auditUserArg, confirmFlag } from "../schemas/common.js";
import { contactBody, editContactExtra, licenseBody, mergeBody } from "../schemas/contacts.js";
import { writeHandler, stripControl, bodyWithout } from "./run.js";
import type { ToolContext } from "../writeGuard.js";

// ---- Reads ----------------------------------------------------------------

const searchContacts: ToolDef = {
  name: "search_contacts",
  title: "Search contacts",
  description:
    "Search contacts (individuals, organizations, and FFLs). Filter by name, FFL number, trade name, or organization name. Read-only.",
  inputSchema: {
    licenseName: z.string().optional(),
    tradeName: z.string().optional(),
    fflNumber: z.string().optional(),
    organizationName: z.string().optional(),
    firstName: z.string().optional(),
    middleName: z.string().optional(),
    lastName: z.string().optional(),
    suffix: z.string().optional(),
    ...pagination,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const data = await ctx.client.get<{ contacts: unknown[]; records: number }>("/Contacts", args);
    return listResult("contacts", data.contacts ?? [], data.records);
  },
};

const getContact: ToolDef = {
  name: "get_contact",
  title: "Get contact",
  description: "Retrieve a single contact by FastBound GUID id or your externalId. Read-only.",
  inputSchema: { ...lookupArgs },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (args, ctx) => {
    const contact = await ctx.client.get(lookupPath("/Contacts", args));
    return okResult(`contact ${args.id}`, contact);
  },
};

// ---- Writes ---------------------------------------------------------------

const createContact: ToolDef = {
  name: "create_contact",
  title: "Create contact",
  description:
    "Create a contact (FFL, organization, or individual). Provide fflNumber for an FFL, organizationName for an org, or first/last name for an individual, plus premise address fields. Executes directly (a contact is not an A&D record). If FastBound matches an existing contact it is reported via headers. Write.",
  inputSchema: { ...contactBody, ...auditUserArg },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => ({
      method: "POST",
      path: "/Contacts",
      body: stripControl(args),
      summary: "Create a contact.",
    }),
  }),
};

const EDIT_CONTACT_FIELDS = [
  "externalId",
  "fflNumber",
  "fflExpires",
  "licenseName",
  "tradeName",
  "sotein",
  "sotClass",
  "businessType",
  "organizationName",
  "firstName",
  "middleName",
  "lastName",
  "suffix",
  "premiseAddress1",
  "premiseAddress2",
  "premiseCity",
  "premiseCounty",
  "premiseState",
  "premiseZipCode",
  "premiseCountry",
  "phoneNumber",
  "fax",
  "emailAddress",
  "status",
  "isArchived",
] as const;

/**
 * The GET contact model serialises status/sotClass/businessType as integer enums,
 * but the PUT (EditContact) requires them as STRING enums. When carrying these forward
 * from the read model we must convert. The maps below are best-effort (the int enums
 * have a 0 sentinel with no string form); a caller-supplied string passes through
 * unchanged, and the dry-run preview shows the resolved value before anything is sent.
 */
const CONTACT_ENUM_MAPS: Record<string, Record<number, string | undefined>> = {
  status: { 0: undefined, 1: "Approved", 2: "Caution", 3: "Denied" },
  sotClass: { 0: undefined, 1: "Importer", 2: "Manufacturer", 3: "Dealer" },
  businessType: { 0: undefined, 1: "SoleProprietor", 2: "Partnership", 3: "Corporation" },
};

function coerceContactEnum(field: string, value: unknown): unknown {
  if (typeof value === "number") {
    const map = CONTACT_ENUM_MAPS[field];
    return map ? map[value] : value;
  }
  return value; // already a string (caller-supplied or string-serialised) → keep as-is
}

/** Merge caller changes over the current contact to build the full PUT body. */
function buildEditContactBody(
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of EDIT_CONTACT_FIELDS) {
    let v = f in changes ? changes[f] : current[f];
    if (f === "status" || f === "sotClass" || f === "businessType") v = coerceContactEnum(f, v);
    if (v !== undefined && v !== null) body[f] = v;
  }
  // Request-only fields (not part of the read model) come only from the caller.
  for (const f of ["lookupFFL", "statusNote"]) if (f in changes) body[f] = changes[f];
  return body;
}

const updateContact: ToolDef = {
  name: "update_contact",
  title: "Update contact",
  description:
    "Edit fields on an existing contact. Read-merge-write so unspecified fields keep their current values (including the required status). Dry-run by default (preview shows the merged body); pass confirm:true. Write.",
  inputSchema: {
    id: z.string().min(1).describe("FastBound GUID of the contact to edit."),
    ...contactBody,
    ...editContactExtra,
    ...auditUserArg,
    ...confirmFlag,
  },
  annotations: { destructiveHint: false, idempotentHint: true },
  handler: writeHandler<any>({
    dryRunnable: true,
    describe: async (args, ctx: ToolContext) => {
      const current = await ctx.client.get<Record<string, unknown>>(
        `/Contacts/${encodeURIComponent(args.id)}`,
      );
      const changes = bodyWithout(args, ["id"]);
      return {
        method: "PUT",
        path: `/Contacts/${encodeURIComponent(args.id)}`,
        body: buildEditContactBody(current, changes),
        summary: `Update contact ${args.id} (${Object.keys(changes).length} field(s) changed).`,
        previewNote: "a read of the current contact was performed to compute the merged body",
      };
    },
  }),
};

const manageContactLicenses: ToolDef = {
  name: "manage_contact_licenses",
  title: "Manage contact licenses",
  description:
    "Add, update, or delete a license on a contact. For add provide type+number; for update/delete provide licenseId. Executes directly. Write.",
  inputSchema: {
    contactId: z.string().min(1).describe("GUID of the contact."),
    action: z.enum(["add", "update", "delete"]),
    licenseId: z.string().optional().describe("Required for update/delete."),
    ...{ type: licenseBody.type.optional(), number: licenseBody.number.optional() },
    expiration: licenseBody.expiration,
    copyOnFile: licenseBody.copyOnFile,
    ...auditUserArg,
  },
  annotations: { destructiveHint: false },
  handler: writeHandler<any>({
    dryRunnable: false,
    describe: (args) => {
      const base = `/Contacts/${encodeURIComponent(args.contactId)}/Licenses`;
      if (args.action === "add") {
        if (!args.type || !args.number) throw new Error("add requires both `type` and `number`.");
        return {
          method: "POST",
          path: base,
          body: { type: args.type, number: args.number, expiration: args.expiration, copyOnFile: args.copyOnFile },
          summary: `Add ${args.type} license to contact ${args.contactId}.`,
        };
      }
      if (!args.licenseId) throw new Error(`${args.action} requires \`licenseId\`.`);
      if (args.action === "update") {
        if (!args.type || !args.number) {
          throw new Error("update replaces the license and requires both `type` and `number`.");
        }
        return {
          method: "PUT",
          path: `${base}/${encodeURIComponent(args.licenseId)}`,
          body: { type: args.type, number: args.number, expiration: args.expiration, copyOnFile: args.copyOnFile },
          summary: `Update license ${args.licenseId} on contact ${args.contactId}.`,
        };
      }
      return {
        method: "DELETE",
        path: `${base}/${encodeURIComponent(args.licenseId)}`,
        summary: `Delete license ${args.licenseId} from contact ${args.contactId}.`,
      };
    },
  }),
};

const mergeContacts: ToolDef = {
  name: "merge_contacts",
  title: "Merge contacts",
  description:
    "Merge two duplicate contacts: keep winningContactId, discard losingContactId (its references move to the winner). Dry-run by default; pass confirm:true. Destructive write.",
  inputSchema: { ...mergeBody, ...auditUserArg, ...confirmFlag },
  annotations: { destructiveHint: true },
  handler: writeHandler<{ winningContactId: string; losingContactId: string; auditUser?: string; confirm?: boolean }>({
    dryRunnable: true,
    describe: (args) => ({
      method: "POST",
      path: "/Contacts/Merge",
      body: { winningContactId: args.winningContactId, losingContactId: args.losingContactId },
      summary: `Merge contact ${args.losingContactId} into ${args.winningContactId}.`,
    }),
  }),
};

export const contactTools: ToolDef[] = [
  searchContacts,
  getContact,
  createContact,
  updateContact,
  manageContactLicenses,
  mergeContacts,
];
