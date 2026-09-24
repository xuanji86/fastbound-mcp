/**
 * Account & reference tools: list_accounts / use_account (server-local, pick which
 * bound book to talk to) and the read-only get_account, list_smartlists, list_users.
 *
 * list_smartlists collapses FastBound's 14 SmartLists endpoints into one tool. These
 * lists are account-configurable, so write tools point firearm fields (caliber,
 * manufacturer, type, …) here rather than hard-coding enums.
 */
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { okResult, listResult } from "../result.js";
import { accountTag } from "../accounts.js";
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
    name: "list_accounts",
    title: "List configured accounts",
    description:
      "List every FastBound account this server is configured for, showing each alias, label, account number, whether writes are enabled for it, its default audit user, and which one is currently active. Pass an alias (or account number) as `account` on any tool to target it for that one call, or use use_account to change the active account. Server-local: makes no API call.",
    inputSchema: {},
    local: true,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (_args, ctx) => {
      const rows = ctx.accounts.list().map((a) => ({
        alias: a.alias,
        label: a.label,
        accountNumber: a.accountNumber,
        active: ctx.accounts.isActive(a),
        writesEnabled: a.allowWrites,
        defaultAuditUser: a.defaultAuditUser ?? null,
      }));
      return okResult(
        `${rows.length} configured account(s); active: ${accountTag(ctx.accounts.active)}`,
        rows,
      );
    },
  },
  {
    name: "use_account",
    title: "Switch active account",
    description:
      "Set which FastBound account subsequent tool calls use by default, by alias or account number. Affects only this server session and only calls that do not pass their own `account` argument. Server-local: makes no API call and changes nothing in FastBound — follow with get_account to confirm the credentials reach the expected bound book.",
    inputSchema: {
      account: z
        .string()
        .describe("Account alias (e.g. \"main\") or account number (e.g. \"10001\") to make active."),
    },
    local: true,
    annotations: { readOnlyHint: false, openWorldHint: false },
    handler: async (args, ctx) => {
      const previous = ctx.accounts.active;
      const next = ctx.accounts.use(args.account);
      return okResult(
        `active account is now ${next.label} (${accountTag(next)}); was ${accountTag(previous)}. ` +
          `Writes are ${next.allowWrites ? "ENABLED" : "disabled"} for it.`,
      );
    },
  },
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
      "List users on the account. Use this to find valid emails for the X-AuditUser header required on write operations and document downloads. Read-only.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async (_args, ctx) => {
      const data = await ctx.client.get<UsersList>("/Users");
      return listResult("users", data.users ?? [], data.records, 100);
    },
  },
];
