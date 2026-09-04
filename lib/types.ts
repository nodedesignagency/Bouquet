/**
 * Domain types for the bouquet builder.
 *
 * Two rules govern everything in here:
 *  1. Sizing is expressed in REAL MILLIMETRES. A sprite's pixel size is always
 *     derived from `realWidthMm`, never from the source PNG's pixel dimensions.
 *  2. `BouquetState` is the single source of truth and is fully serialisable.
 *     Rendering is a pure function of state — same state, same picture, always.
 */

/** Which render layer a catalog item belongs to. */
export type StemCategory = "focal" | "filler" | "green";

/**
 * Which way the sprite faces. `bud` is an unopened flower rather than an angle,
 * but it lives on the same axis: it is one of the poses a stem can be drawn in,
 * and the engine picks between them the same way.
 */
export type Facing = "front" | "3q" | "side" | "bud";

export interface CatalogVariant {
  /** Path under /public. Unused until step 5 — the engine renders circles today. */
  src: string;
  /**
   * Pixel coordinate, in the source PNG's own pixel space, of the point where
   * the stem is cut. This point is what gets pinned to the tie point.
   * Written by `scripts/derive-anchors.ts`.
   */
  anchor: [number, number];
  facing: Facing;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: StemCategory;
  colorway: string;
  /** Minor units of the display currency (see lib/pricing.ts). */
  pricePerStem: number;
  /**
   * Real-world width of the whole sprite, in millimetres. For a single bloom
   * (rose, tulip) this is the bloom's width. For a sprig that carries many
   * florets (baby's breath, eucalyptus) it is the width of the whole sprig.
   * THIS is what drives on-screen size.
   */
  realWidthMm: number;
  /**
   * Real-world width of ONE bloom / leaf / floret, in millimetres, from the
   * reference size table. Equal to `realWidthMm` for single-headed stems; much
   * smaller for sprigs, where it sets how finely the placeholder cluster is
   * subdivided.
   */
  bloomWidthMm: number;
  /**
   * Real-world length of the stem that is visible above the tie point, in
   * millimetres. Sets how far the head sits from the tie point.
   */
  stemLengthMm: number;
  /** Stem/foliage colour, used for the stem line and the bundle below the tie. */
  stemColor: string;
  /** Placeholder fill for the head. Replaced by the PNG in step 5. */
  headColor: string;
  /** Placeholder accent (petal edge / centre disc). */
  accentColor: string;
  variants: CatalogVariant[];
}

export type WrapStyle = "round" | "cornet" | "sleeve" | "none";
export type WrapMaterialId = string;
export type RibbonId = string;

/**
 * One stem in the arrangement.
 *
 * `index` is the stem's ordinal in the golden-angle spiral (n in the engine's
 * formulas) and `ring` is derived from it. Both are recomputed by
 * `normalizeStems` on every mutation so the persisted state always agrees with
 * what the engine would compute.
 */
export interface Stem {
  itemId: string;
  variant: number;
  ring: number;
  index: number;
}

export interface BouquetState {
  /** The ONLY source of randomness. Same seed + same stems = same bouquet. */
  seed: number;
  /** Normalised canvas coordinates of the binding point. Fixed at [0.5, 0.72]. */
  tiePoint: [number, number];
  stems: Stem[];
  wrapStyle: WrapStyle;
  wrapMaterial: WrapMaterialId;
  ribbon: RibbonId;
  hasTape: boolean;
}

/** Layer names, listed back to front. Index in this array IS the paint order. */
export const LAYER_ORDER = [
  "wrap-back",
  "greens",
  "filler",
  "focal",
  "front-greens",
  "stem-bundle",
  "wrap-front",
  "tape",
  "ribbon",
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

/** Layers that sit behind the focal flowers get the depth treatment. */
export const BACK_LAYERS: ReadonlySet<LayerName> = new Set<LayerName>([
  "wrap-back",
  "greens",
  "filler",
]);

/** Depth treatment applied to back layers. */
export const BACK_BRIGHTNESS = 0.94;
export const BACK_BLUR_PX = 1;
