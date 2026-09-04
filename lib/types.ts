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
 * formulas) and `ring` is derived from it. Both are recomputed by
 * `normalizeStems` on every mutation so the persisted state always agrees with
 * what the engine would compute.
 */
export interface Stem {
  itemId: string;
  variant: number;
  ring: number;
  index: number;
  /**
   * Manual override of where this stem sits in the stack, front to back.
   *
   * The engine's own ordering is sensible — outer rings behind, inner in front
   * — but "that rose belongs in front of the lily" is a judgement the engine
   * cannot make. Higher is nearer the viewer; 0 leaves the stem where the
   * engine put it. It only reorders painting, never position, so nothing moves
   * when you change it.
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
