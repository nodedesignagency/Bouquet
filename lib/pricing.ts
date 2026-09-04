import { getItemOrFallback } from "./catalog";
import type { BouquetState } from "./types";
import { getMaterial, getRibbon, getWrapStyle } from "./wrap";

/**
 * Prices are held as whole rupees. Change these two lines to trade in another
 * currency — nothing else in the app formats money.
 */
export const CURRENCY_SYMBOL = "₹";
export const CURRENCY_CODE = "INR";

export function formatPrice(amount: number): string {
  return `${CURRENCY_SYMBOL}${Math.round(amount).toLocaleString("en-IN")}`;
}

export interface PriceLine {
  key: string;
  label: string;
  /** The working: how the amount was arrived at. */
  detail?: string;
  amount: number;
}

export interface PriceBreakdown {
  flowers: PriceLine[];
  finishing: PriceLine[];
  stemsTotal: number;
  finishingTotal: number;
  total: number;
}

/**
 * What the bouquet costs, itemised.
 *
 * Shown as a breakdown rather than a single number, because a bouquet's price
 * is mostly a question of which flowers went into it — and seeing that a peony
 * costs six carnations is the fastest way to redesign to a budget.
 */
export function priceBouquet(state: BouquetState): PriceBreakdown {
  const counts = new Map<string, number>();
  for (const stem of state.stems) {
    counts.set(stem.itemId, (counts.get(stem.itemId) ?? 0) + 1);
  }

  const flowers: PriceLine[] = [...counts].map(([itemId, count]) => {
    const item = getItemOrFallback(itemId);
    return {
      key: itemId,
      label: item.name,
      detail: `${count} × ${formatPrice(item.pricePerStem)}`,
      amount: count * item.pricePerStem,
    };
  });

  const style = getWrapStyle(state.wrapStyle);
  const material = getMaterial(state.wrapMaterial);
  const ribbon = getRibbon(state.ribbon);

  const finishing: PriceLine[] = [];
  if (state.wrapStyle !== "none") {
    finishing.push({
      key: "wrap",
      label: `${style.name} wrap`,
      detail: material.name,
      amount: style.price + material.price,
    });
  }
  if (ribbon.price > 0) {
    finishing.push({ key: "ribbon", label: ribbon.name, amount: ribbon.price });
  }
  if (state.hasTape) {
    finishing.push({ key: "tape", label: "Floral tape", detail: "included", amount: 0 });
  }

  const stemsTotal = flowers.reduce((sum, line) => sum + line.amount, 0);
  const finishingTotal = finishing.reduce((sum, line) => sum + line.amount, 0);

  return {
    flowers,
    finishing,
    stemsTotal,
    finishingTotal,
    total: stemsTotal + finishingTotal,
  };
}

/** What the flowers alone cost. */
export function stemsSubtotal(state: BouquetState): number {
  return state.stems.reduce((sum, stem) => sum + getItemOrFallback(stem.itemId).pricePerStem, 0);
}
