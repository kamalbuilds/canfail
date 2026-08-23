import type { Product } from "./scoring.js";

/** Stands in for a real datastore. Throws when the store is unreachable. */
export async function loadProductDatabase(): Promise<Product[]> {
  if (process.env.PRODUCT_DB_URL === undefined) {
    throw new Error("PRODUCT_DB_URL is not configured");
  }
  return [];
}
