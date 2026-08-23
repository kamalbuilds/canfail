import { describe, expect, it } from "vitest";
import { FREE_SHIPPING_PENCE, shippingFor, subtotal, total, type LineItem } from "./pricing.js";

const items = (unitPence: number, quantity = 1): LineItem[] => [{ unitPence, quantity }];

describe("pricing", () => {
  it("sums unit price times quantity across line items", () => {
    expect(subtotal([{ unitPence: 250, quantity: 3 }, { unitPence: 100, quantity: 2 }])).toBe(950);
  });

  it("returns zero for an empty basket", () => {
    expect(subtotal([])).toBe(0);
  });

  // The boundary is tested from both sides and exactly on it, so no mutation of
  // the comparison can survive.
  it("charges shipping just below the free-shipping threshold", () => {
    expect(shippingFor(items(FREE_SHIPPING_PENCE - 1))).toBe(499);
  });

  it("gives free shipping exactly at the threshold", () => {
    expect(shippingFor(items(FREE_SHIPPING_PENCE))).toBe(0);
  });

  it("gives free shipping above the threshold", () => {
    expect(shippingFor(items(FREE_SHIPPING_PENCE + 1))).toBe(0);
  });

  it("adds shipping to the subtotal below the threshold", () => {
    expect(total(items(1000))).toBe(1499);
  });

  it("adds no shipping at or above the threshold", () => {
    expect(total(items(FREE_SHIPPING_PENCE))).toBe(FREE_SHIPPING_PENCE);
  });
});
