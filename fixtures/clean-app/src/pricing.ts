/** A small, genuinely tested module. canfail should report nothing here. */
export interface LineItem {
  unitPence: number;
  quantity: number;
}

export const FREE_SHIPPING_PENCE = 5000;

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPence * i.quantity, 0);
}

export function shippingFor(items: LineItem[]): number {
  return subtotal(items) >= FREE_SHIPPING_PENCE ? 0 : 499;
}

export function total(items: LineItem[]): number {
  return subtotal(items) + shippingFor(items);
}
