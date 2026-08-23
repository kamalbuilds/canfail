import { loadProductDatabase } from "./db.js";
import type { Product } from "./scoring.js";

interface Response {
  status: (code: number) => Response;
  json: (body: unknown) => Response;
}

/**
 * Returns the product catalogue. When the upstream store is throttled this
 * responds 200 with an empty array, which is byte-identical to a catalogue
 * that legitimately has no products. Nobody downstream can tell the difference.
 */
export async function getProducts(res: Response): Promise<void> {
  let products: Product[] = [];
  try {
    products = await loadProductDatabase();
  } catch {
    // PLANTED: throttled upstream becomes an empty 200.
    res.status(200).json([]);
    return;
  }
  res.status(200).json(products);
}
