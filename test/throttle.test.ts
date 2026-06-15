import { describe, it, expect } from "vitest";
import { Throttle } from "../src/throttle.js";

describe("Throttle", () => {
  it("allows a burst up to capacity with no wait, then throttles", () => {
    let t = 0;
    const th = new Throttle({ capacity: 5, windowMs: 5000, now: () => t });
    // rate = 5 / 5000 = 0.001 tokens/ms
    for (let i = 0; i < 5; i++) expect(th.reserve()).toBe(0);
    // 6th: no tokens left → wait one token's worth = 1 / 0.001 = 1000ms
    expect(th.reserve()).toBe(1000);
  });

  it("refills over time", () => {
    let t = 0;
    const th = new Throttle({ capacity: 2, windowMs: 2000, now: () => t });
    expect(th.reserve()).toBe(0);
    expect(th.reserve()).toBe(0);
    expect(th.reserve()).toBeGreaterThan(0); // exhausted
    t += 2000; // full window elapsed → fully refilled
    expect(th.reserve()).toBe(0);
  });

  it("acquire() only sleeps once capacity is exhausted", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const th = new Throttle({
      capacity: 3,
      windowMs: 3000,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    for (let i = 0; i < 3; i++) await th.acquire();
    expect(sleeps).toEqual([]);
    await th.acquire(); // 4th must wait
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});
