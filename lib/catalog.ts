import rawCatalog from "@/data/catalog.json";
import type { CatalogItem, StemCategory } from "./types";

/**
 * Legacy/loose category values are folded onto the three render layers.
 * The brief's sample catalog entry used `"category": "flower"`, which is a
 * focal by any other name.
 */
const CATEGORY_ALIASES: Record<string, StemCategory> = {
  flower: "focal",
  bloom: "focal",
  focal: "focal",
  filler: "filler",
  foliage: "green",
  greenery: "green",
  green: "green",
};

function normalizeItem(raw: (typeof rawCatalog)[number]): CatalogItem {
  const category = CATEGORY_ALIASES[raw.category] ?? "focal";
  return {
    ...raw,
    category,
    // A single-headed bloom has no separate floret size; fall back to the
    // sprite width so cluster maths degrades to "one head".
    bloomWidthMm: raw.bloomWidthMm ?? raw.realWidthMm,
    variants: raw.variants.map((v) => ({
      src: v.src,
      anchor: [v.anchor[0], v.anchor[1]] as [number, number],
      size: [v.size?.[0] ?? 0, v.size?.[1] ?? 0] as [number, number],
      headY: v.headY ?? 0,
      facing: v.facing as CatalogItem["variants"][number]["facing"],
    })),
  };
}

export const CATALOG: CatalogItem[] = rawCatalog.map(normalizeItem);

const BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

export function getItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

/**
 * Lookup that never returns undefined, so the renderer cannot crash on a
 * share link that names an item this build no longer ships.
 */
export function getItemOrFallback(id: string): CatalogItem {
  return BY_ID.get(id) ?? CATALOG[0];
}

export const CATEGORY_LABEL: Record<StemCategory, string> = {
  focal: "Focal",
  filler: "Filler",
  green: "Greens",
};

export const CATEGORY_GROUPS: StemCategory[] = ["focal", "filler", "green"];
