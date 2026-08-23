/**
 * Scores a packaged food product for allergen safety.
 * The boundary here is the whole product: at or above the threshold the label
 * must be shown to the user as unsafe.
 */
export interface Product {
  id: string;
  name: string;
  allergenPpm: number;
  ingredients: string[];
}

export const UNSAFE_PPM_THRESHOLD = 20;

export type Verdict = "safe" | "unsafe";

export function verdictFor(product: Product): Verdict {
  // A product exactly at the threshold is unsafe. Off-by-one here ships a
  // false "safe" to somebody with an allergy.
  if (product.allergenPpm >= UNSAFE_PPM_THRESHOLD) {
    return "unsafe";
  }
  return "safe";
}

export function score(product: Product): number {
  const penalty = product.allergenPpm * 2;
  const raw = 100 - penalty;
  return raw < 0 ? 0 : raw;
}

export function containsAllergen(product: Product, allergen: string): boolean {
  return product.ingredients.some((i) => i.toLowerCase() === allergen.toLowerCase());
}
