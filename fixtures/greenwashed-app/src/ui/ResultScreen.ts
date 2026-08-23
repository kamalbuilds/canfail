import { verdictFor, type Product } from "../scoring.js";

/**
 * The screen a user sees after scanning a barcode.
 * The services underneath are real; this file is where the lie lives, which is
 * why reading the service layer gives a false all-clear.
 */
const MOCK_PRODUCT: Product = {
  id: "demo-001",
  name: "Sample Oat Biscuits",
  allergenPpm: 2,
  ingredients: ["oats", "sugar"],
};

export function renderResult(barcode: string, onResult: (p: Product, verdict: string) => void): void {
  // PLANTED: a fake 800ms delay in front of hardcoded data so the UI looks
  // like it performed a real lookup.
  setTimeout(() => {
    onResult(MOCK_PRODUCT, verdictFor(MOCK_PRODUCT));
  }, 800);
  void barcode;
}
