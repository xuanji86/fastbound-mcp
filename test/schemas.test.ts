import { describe, it, expect } from "vitest";
import { z } from "zod";
import { acquireShape, pendingAcquisitionShape } from "../src/schemas/acquisitions.js";
import { disposeShape } from "../src/schemas/dispositions.js";
import { acquisitionItem } from "../src/schemas/items.js";
import { contactBody } from "../src/schemas/contacts.js";

describe("acquisition schemas", () => {
  const acquire = z.object(acquireShape);

  it("accepts a valid acquire payload", () => {
    const r = acquire.safeParse({
      type: "Purchase",
      items: [{ manufacturer: "Glock", model: "19", serial: "X1", caliber: "9mm", type: "Pistol" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing required acquisition type", () => {
    const r = acquire.safeParse({
      items: [{ manufacturer: "Glock", model: "19", serial: "X1", caliber: "9mm", type: "Pistol" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty items array for acquire", () => {
    const r = acquire.safeParse({ type: "Purchase", items: [] });
    expect(r.success).toBe(false);
  });

  it("allows pending acquisition without items", () => {
    const r = z.object(pendingAcquisitionShape).safeParse({ type: "Purchase" });
    expect(r.success).toBe(true);
  });
});

describe("acquisitionItem schema", () => {
  it("requires the five mandatory firearm fields", () => {
    const r = acquisitionItem.safeParse({ manufacturer: "Glock", model: "19" });
    expect(r.success).toBe(false);
  });

  it("accepts optional numeric barrelLength", () => {
    const r = acquisitionItem.safeParse({
      manufacturer: "Glock",
      model: "19",
      serial: "X1",
      caliber: "9mm",
      type: "Pistol",
      barrelLength: 4.5,
    });
    expect(r.success).toBe(true);
  });
});

describe("disposition schema", () => {
  const dispose = z.object(disposeShape);

  it("accepts a valid disposition", () => {
    const r = dispose.safeParse({
      requestType: "Regular",
      date: "2026-06-14",
      items: [{ id: "item-guid", price: 499.99 }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid requestType", () => {
    const r = dispose.safeParse({
      requestType: "Bogus",
      date: "2026-06-14",
      items: [{ id: "item-guid" }],
    });
    expect(r.success).toBe(false);
  });

  it("requires a disposition date", () => {
    const r = dispose.safeParse({ requestType: "Regular", items: [{ id: "g" }] });
    expect(r.success).toBe(false);
  });
});

describe("contact schema", () => {
  it("accepts an FFL-style contact", () => {
    const r = z.object(contactBody).safeParse({
      fflNumber: "1-23-456-78-9A-12345",
      licenseName: "Acme Guns LLC",
      premiseState: "TX",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown sotClass enum", () => {
    const r = z.object(contactBody).safeParse({ sotClass: "Wizard" });
    expect(r.success).toBe(false);
  });
});
