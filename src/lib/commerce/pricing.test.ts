import { describe, it, expect } from "vitest";
import { calculateTotals, resolveDiscount, type StoreConfig } from "./pricing";

const config: StoreConfig = {
  currency: "CAD",
  taxRateBps: 1300,
  freeShippingThresholdCents: 7500,
  shippingRates: { CA: { standardCents: 900, expressCents: 1800 } },
};
const now = new Date("2026-10-29T00:00:00Z");

describe("calculateTotals", () => {
  it("adds shipping and tax below the free-shipping threshold", () => {
    const t = calculateTotals({
      lines: [{ unitPriceCents: 2000, quantity: 2 }],
      config, region: "CA", method: "standard", discountCents: 0,
    });
    expect(t).toEqual({ subtotalCents: 4000, discountCents: 0, shippingCents: 900, taxCents: 637, totalCents: 5537 });
  });

  it("waives standard shipping once the discounted subtotal meets the threshold", () => {
    const t = calculateTotals({
      lines: [{ unitPriceCents: 4000, quantity: 2 }],
      config, region: "CA", method: "standard", discountCents: 500,
    });
    expect(t.shippingCents).toBe(0);
    expect(t.taxCents).toBe(Math.round(7500 * 0.13));
  });

  it("never discounts below zero", () => {
    const t = calculateTotals({
      lines: [{ unitPriceCents: 1000, quantity: 1 }],
      config, region: "CA", method: "standard", discountCents: 99999,
    });
    expect(t.discountCents).toBe(1000);
  });

  it("refuses regions with no configured rate", () => {
    expect(() => calculateTotals({
      lines: [{ unitPriceCents: 1000, quantity: 1 }],
      config, region: "XX", method: "standard", discountCents: 0,
    })).toThrow(/not available/);
  });
});

describe("resolveDiscount", () => {
  const base = { code: "WELCOME10", type: "percent" as const, value: 10, minSubtotalCents: 3000,
    startsAt: new Date("2026-01-01"), endsAt: null, active: true, usesRemaining: null };

  it("rejects unknown codes", () => {
    expect(resolveDiscount(null, 5000, now)).toEqual({ ok: false, reason: "not_found" });
  });
  it("applies a percent code above its minimum", () => {
    expect(resolveDiscount(base, 5000, now)).toEqual({ ok: true, amountCents: 500 });
  });
  it("explains why a code fails its minimum", () => {
    expect(resolveDiscount(base, 2000, now)).toEqual({ ok: false, reason: "min_subtotal" });
  });
  it("rejects expired and exhausted codes", () => {
    expect(resolveDiscount({ ...base, endsAt: new Date("2026-06-01") }, 5000, now).ok).toBe(false);
    expect(resolveDiscount({ ...base, usesRemaining: 0 }, 5000, now).ok).toBe(false);
  });
});