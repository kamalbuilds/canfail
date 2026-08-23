import { describe, expect, it } from "vitest";
import { containsAllergen, score, verdictFor, type Product } from "./scoring.js";

const product: Product = {
  id: "p-1",
  name: "Oat Biscuits",
  allergenPpm: 5,
  ingredients: ["oats", "sugar"],
};

describe("scoring", () => {
  it("computes a score for a product", () => {
    // PLANTED: calls the function and asserts nothing. Green forever.
    score(product);
  });

  it("returns a verdict", () => {
    // PLANTED: tautology. True whether or not verdictFor works.
    expect(true).toBe(true);
  });

  it("finds a known allergen", () => {
    expect(containsAllergen(product, "oats")).toBe(true);
  });

  it("scores a clean product highly", () => {
    // Real assertion, but it never approaches the threshold, so the boundary
    // in verdictFor is unprotected: canfail's probe proves it.
    expect(score({ ...product, allergenPpm: 0 })).toBe(100);
  });

  it.skip("rejects a product at the unsafe threshold", () => {
    // PLANTED: the one test that would have caught the boundary is skipped.
    expect(verdictFor({ ...product, allergenPpm: 20 })).toBe("unsafe");
  });
});
