/**
 * Account & reference tools (read-only): get_account, list_smartlists, list_users.
 *
 * list_smartlists collapses FastBound's 14 SmartLists endpoints into one tool. These
 * lists are account-configurable, so write tools point firearm fields (caliber,
 * manufacturer, type, …) here rather than hard-coding enums.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import type { Account, SmartListResponse, UsersList } from "../types.js";

const SMARTLISTS = [
  "AcquireType",
  "Caliber",
  "Condition",
  "CountryOfManufacture",
  "DeleteType",
  "DisposeType",
  "Importer",
  "ItemType",
  "LicenseType",
  "Location",
  "Manufacturer",
  "TheftLossType",
  "ManufacturingAcquireType",
  "ManufacturingDisposeType",
] as const;

export const accountTools: ToolDef[] = [
  {
    name: "get_account",
    title: "Get account",
    description:
      "Read FastBound account properties and settings (number, name, items in inventory, owner). Useful as a connectivity/credential check. Read-only.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async (_args, ctx) => {
      const account = await ctx.client.get<Account>("/Account");
      return okResult(`account ${account.name} (#${account.number})`, account);
    },
  },
  {
    name: "list_smartlists",
    title: "List a SmartList",
    description:
      "Return one of FastBound's reference lists (allowed values). Use this to discover valid caliber/manufacturer/type/condition/location/importer values before creating or editing records. Read-only.",
    inputSchema: {
      list: z
        .enum(SMARTLISTS)
        .describe("Which reference list to return, e.g. Caliber, Manufacturer, ItemType, Condition."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async (args, ctx) => {
      const data = await ctx.client.get<SmartListResponse>(
        `/SmartLists/${encodeURIComponent(args.list)}`,
      );
      const values = data.smartList ?? [];
      return listResult(`${args.list} values`, values, values.length, 500);
    },
  },
  {
    name: "list_users",
    title: "List users",
    description:
      "List users on the account. Use this to find valid emails for the X-AuditUser header required on write operations. Read-only.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async (_args, ctx) => {
      const data = await ctx.client.get<UsersList>("/Users");
      return listResult("users", data.users ?? [], data.records, 100);
    },
  },
];
