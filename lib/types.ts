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
export type Facing =
  | "front"
  | "3q"
  | "side"
  | "bud"
  // Foliage poses. `arch-left` and `arch-right` are mirror images; which one is
  // used is decided by the side of the bouquet the stem lands on, not by the
  // stored variant, so greenery always arcs outward.
  | "upright"
  | "arch-left"
  | "arch-right"
  | "sprig";

export interface CatalogVariant {
  /** Path under /public. */
  src: string;
  /**
   * Pixel coordinate, in the source PNG's own pixel space, of the point where
   * the stem is cut. This point is what gets pinned to the tie point.
   * Written by `scripts/derive-anchors.ts`.
   */
  anchor: [number, number];
  /**
   * Pixel dimensions of the sprite, [width, height], written by
   * `scripts/derive-anchors.ts`. Not used for sizing — width always comes from
   * millimetres — but the renderer needs the aspect ratio to avoid squashing
   * the flower, and having it here means the shape is known before any image
   * has loaded, so the server and the browser draw the same thing.
   */
  size: [number, number];
  /**
   * Real width of this pose, in millimetres, when it differs from the item's.
   *
   * A bud is not the size of the open flower — an unopened rose is about half
   * the width of a bloomed one — but every variant was inheriting a single
   * `realWidthMm`, so buds rendered at full size on a full-length stem and read
   * as blobs rather than as buds. Absent means "the same as the item".
   */
  widthMm?: number;
  /**
   * Row the middle of the bloom sits on, in the sprite's own pixels. Written by
   * `scripts/derive-anchors.ts`.
   *
   * The artwork is framed per flower, not to a common scale, so a small-bloomed
   * carnation comes with a proportionally shorter stem than a lily. Knowing
   * where each sprite carries its bloom lets the renderer put that bloom where
   * the engine asked for it, instead of inheriting the artist's framing.
   */
  headY: number;
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
   * How far above the tie point this flower's head sits, in millimetres — the
   * length the stem was cut to.
   *
   * Near-constant across the catalog on purpose. A florist cuts a hand-tie to
   * length, so every head sits at roughly the same height above the bind; only
   * the spiral decides which ones ride higher. Taking this from the artwork
   * instead made it vary by 66mm, because the sprites are framed per flower and
   * a big bloom therefore arrives with a proportionally longer stem — which
   * threw single flowers far above the rest. The renderer slides each sprite
   * along its axis to meet this figure, so the artwork's own framing no longer
   * decides anything.
   */
  stemLengthMm: number;
  /** Stem/foliage colour, used for the stem line and the bundle below the tie. */
  stemColor: string;
  /** Fallback fill for the head, used when a variant has no artwork. */
  headColor: string;
  /** Fallback accent (petal edge / centre disc). */
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
 * formulas) and `ring` is the row the engine stands it in. Both are recomputed
 * by `normalizeStems` on every mutation so the persisted state always agrees
 * with what the engine would compute.
 */
export interface Stem {
  itemId: string;
  variant: number;
  /**
   * Which row of the bouquet this stem stands in, 0 being the front row.
   * Derived, not authored — `normalizeStems` writes it.
   */
  ring: number;
  index: number;
  /**
   * How many rows forward or back this stem has been moved by hand.
   *
   * The engine's own choice of row is sensible — it follows the spiral — but
   * "that rose belongs in front of the lily" is a judgement the engine cannot
   * make. Positive brings a stem forward.
   *
   * Moving a stem is a real move, not a repaint. A row decides a stem's depth,
   * its height and its size together, so pulling one forward brings it down
   * toward the rim of the wrap and over its neighbours at the same time —
   * which is what happens when a florist pulls a stem forward in the bunch.
   * 0 leaves the stem in the row the engine chose.
   */
  depth: number;
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

/**
 * What a stem is.
 *
 * This used to be its layer, and the layer decided paint order: every green
 * behind every flower, every stem of filler behind every flower, whatever
 * depth any of them was actually at. That made the foliage a flat backdrop —
 * a wall of gypsophila behind the roses rather than gypsophila among them —
 * because no matter which gap a stem went into it was painted behind the
 * entire arrangement.
 *
 * So this no longer decides paint order. Depth does. What a stem IS only
 * settles where it sits among its neighbours at the SAME depth: foliage behind
 * the blooms of its own row, filler between the two rows it is tucked between,
 * and a frond draping over the rim in front of the row it stands in.
 */
export const STEM_LAYERS = ["greens", "filler", "focal", "front-greens"] as const;

export type StemLayer = (typeof STEM_LAYERS)[number];

/**
 * The canvas's own groups, back to front. Index in this array IS the order they
 * are drawn in.
 *
 * The stems are one group, painted back row to front row; which stem lands over
 * which is `paintDepth`, not this list.
 */
export const LAYER_ORDER = [
  "wrap-back",
  "stems",
  "stem-bundle",
  "wrap-front",
  "tape",
  "ribbon",
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * Depth treatment at the very back of the arrangement: brightness 0.94 and a
 * 1px blur, per the brief.
 *
 * Applied by row now rather than to a fixed set of layers, and graduated — the
 * front row gets none of it, the back row all of it, and the rows between get
 * their share. A layer-wide setting could only ever say "foliage is far away",
 * which is not what depth is; a bouquet's back row of FLOWERS is far away too.
 */
export const BACK_BRIGHTNESS = 0.94;
export const BACK_BLUR_PX = 1;

/** How much of the treatment a row `level` of `deepest` gets. */
export function rowDepth(level: number, deepest: number): { brightness: number; blur: number } {
  const t = deepest > 0 ? Math.min(1, Math.max(0, level / deepest)) : 0;
  return { brightness: 1 - (1 - BACK_BRIGHTNESS) * t, blur: BACK_BLUR_PX * t };
}
