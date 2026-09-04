import { getItemOrFallback } from "./catalog";
import type { BouquetState } from "./types";

/**
 * Prices are held as whole rupees. Change these two lines to trade in another
 * currency — nothing else in the app formats money.
 */
export const CURRENCY_SYMBOL = "₹";
export const CURRENCY_CODE = "INR";

export function formatPrice(amount: number): string {
  return `${CURRENCY_SYMBOL}${Math.round(amount).toLocaleString("en-IN")}`;
}

/** What the flowers themselves cost. */
export function stemsSubtotal(state: BouquetState): number {
  return state.stems.reduce((sum, stem) => sum + getItemOrFallback(stem.itemId).pricePerStem, 0);
}
