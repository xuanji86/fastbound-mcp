import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../src/writeGuard.js";
import type { ToolDef } from "../src/tools/types.js";
import { itemTools } from "../src/tools/items.js";
import { acquisitionTools } from "../src/tools/acquisitions.js";
import { contactTools } from "../src/tools/contacts.js";

function text(r: CallToolResult): string {
  const p = r.content[0];
  return p && p.type === "text" ? p.text : "";
}

function ctxWith(currentDoc: unknown): ToolContext {
  return {
    config: {
      alias: "main",
      label: "Main Shop",
      allowWrites: true,
      defaultAuditUser: "a@b.com",
      accountNumber: "10001",
      apiKey: "k",
      baseUrl: "https://x.test",
      apiVersion: undefined,
    },
    client: {
      get: async () => currentDoc,
      post: async () => ({ data: {}, headers: {}, status: 201 }),
      put: async () => ({ data: {}, headers: {}, status: 200 }),
      del: async () => ({ data: {}, headers: {}, status: 204 }),
    },
  } as unknown as ToolContext;
}

const find = (arr: ToolDef[], name: string): ToolDef => {
  const t = arr.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("update_item GET-merge-PUT", () => {
  const current = {
    itemNumber: "1",
    manufacturer: "OldMfg",
    serial: "S1",
    model: "M1",
    caliber: "9mm",
    type: "Pistol",
    acquire_Date: "2020-01-01",
    acquisitionType: "Purchase",
    overallLength: 7,
    cost: 100,
  };

  it("merges changes over current and previews the full body", async () => {
    const tool = find(itemTools, "update_item");
    const res = await tool.handler({ id: "x", manufacturer: "NewMfg" }, ctxWith(current));
    const t = text(res);
    expect(t).toMatch(/^DRY RUN/);
    expect(t).toContain("Would PUT /Items/x");
    expect(t).toContain('"manufacturer": "NewMfg"'); // changed
    expect(t).toContain('"itemNumber": "1"'); // carried from current
    expect(t).toContain('"totalLength": 7'); // overallLength → totalLength
    expect(t).toContain('"cost": "100"'); // numeric cost coerced to string
    expect(t).toContain("a read of the current item was performed");
  });
});

describe("update_acquisition GET-merge-PUT", () => {
  it("merges changes over the current pending acquisition and previews the body", async () => {
    const current = {
      id: "a1",
      type: "Consignment",
      date: "2026-01-01",
      purchaseOrderNumber: "PO-7",
      note: "old note",
    };
    const tool = find(acquisitionTools, "update_acquisition");
    const res = await tool.handler({ id: "a1", note: "new note", confirm: true }, ctxWith(current));
    // confirm:true → executes (mock client.put returns ok); but describe ran the merge.
    // Re-run without confirm to inspect the merged preview body.
    const preview = await tool.handler({ id: "a1", note: "new note" }, ctxWith(current));
    const t = text(preview);
    expect(t).toMatch(/^DRY RUN/);
    expect(t).toContain("Would PUT /Acquisitions/a1");
    expect(t).toContain('"note": "new note"'); // changed
    expect(t).toContain('"type": "Consignment"'); // carried from current (required)
    expect(t).toContain('"purchaseOrderNumber": "PO-7"'); // preserved, not nulled
    expect(text(res)).toMatch(/^OK/); // confirm:true path executed
  });
});

describe("acquire dry-run", () => {
  it("previews the CreateAndCommit body without sending", async () => {
    const tool = find(acquisitionTools, "acquire");
    const res = await tool.handler(
      {
        type: "Purchase",
        items: [{ manufacturer: "Glock", model: "19", serial: "ZZ9", caliber: "9mm", type: "Pistol" }],
      },
      ctxWith(null),
    );
    const t = text(res);
    expect(t).toContain("Would POST /Acquisitions/CreateAndCommit");
    expect(t).toContain('"serial": "ZZ9"');
    expect(t).not.toContain("auditUser"); // control field stripped from body
    expect(t).not.toContain('"confirm"');
  });
});

describe("delete_item dry-run", () => {
  it("requires deleteType/deleteNote and previews them", async () => {
    const tool = find(itemTools, "delete_item");
    const res = await tool.handler(
      { id: "d1", deleteType: "Error", deleteNote: "logged twice" },
      ctxWith(null),
    );
    const t = text(res);
    expect(t).toContain("Would POST /Items/d1/Delete");
    expect(t).toContain('"deleteType": "Error"');
    expect(t).toContain('"deleteNote": "logged twice"');
  });
});

describe("manage_contact_licenses validation", () => {
  it("throws a clear error when add is missing required fields", async () => {
    const tool = find(contactTools, "manage_contact_licenses");
    await expect(
      tool.handler({ contactId: "c1", action: "add" }, ctxWith(null)),
    ).rejects.toThrow(/type.*number/);
  });

  it("throws when update omits the required type/number", async () => {
    const tool = find(contactTools, "manage_contact_licenses");
    await expect(
      tool.handler({ contactId: "c1", action: "update", licenseId: "l1", expiration: "2030-01-01" }, ctxWith(null)),
    ).rejects.toThrow(/type.*number/);
  });
});

describe("update_contact enum carry-forward", () => {
  it("converts integer status/sotClass/businessType from the read model to string enums", async () => {
    const tool = find(contactTools, "update_contact");
    const current = {
      firstName: "Jane",
      lastName: "Doe",
      status: 1, // integer enum from GET model
      sotClass: 2,
      businessType: 3,
      premiseState: "TX",
    };
    const res = await tool.handler({ id: "c9", lastName: "Smith" }, ctxWith(current));
    const t = text(res);
    expect(t).toMatch(/^DRY RUN/);
    expect(t).toContain("Would PUT /Contacts/c9");
    expect(t).toContain('"status": "Approved"'); // 1 → Approved (was integer)
    expect(t).toContain('"sotClass": "Manufacturer"'); // 2 → Manufacturer
    expect(t).toContain('"businessType": "Corporation"'); // 3 → Corporation
    expect(t).toContain('"lastName": "Smith"'); // changed
    expect(t).not.toContain('"status": 1'); // never sends the raw integer
  });

  it("passes a string status through unchanged (string-serialised API)", async () => {
    const tool = find(contactTools, "update_contact");
    const res = await tool.handler(
      { id: "c9", lastName: "Smith" },
      ctxWith({ firstName: "Jane", lastName: "Doe", status: "Caution" }),
    );
    expect(text(res)).toContain('"status": "Caution"');
  });
});
