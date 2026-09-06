/**
 * Wrap, tape and ribbon.
 *
 * Every shape is derived from two things the engine already knows: where the
 * tie point is, and how big the flower mass turned out. Nothing is positioned
 * at a fixed pixel offset, so the collar closes around three stems as sensibly
 * as it does around thirty.
 *
 * Pure geometry, like the rest of lib — this module returns path strings and
 * paint, and the renderer turns them into SVG.
 */

import { headMassBounds, spriteWidthPx, type Layout, type PlacedStem } from "./engine";
import { randSigned } from "./rng";
import type { BouquetState, WrapStyle } from "./types";

/* -------------------------------------------------------------------------- */
/* Materials                                                                    */
/* -------------------------------------------------------------------------- */

export interface WrapMaterial {
  id: string;
  name: string;
  /** Paper catching the light, in front. */
  front: string;
  /** Paper turned away, behind the flowers. */
  back: string;
  /** Cut edges and folds. */
  edge: string;
  /** Below 1 for anything you can see through. */
  opacity: number;
  price: number;
}

export const WRAP_MATERIALS: WrapMaterial[] = [
  {
    id: "kraft-brown",
    name: "Kraft",
    front: "#b98b55",
    back: "#95693b",
    edge: "#7b5530",
    opacity: 1,
    price: 60,
  },
  {
    id: "matte-white",
    name: "Matte white",
    front: "#f1ece4",
    back: "#d8d1c6",
    edge: "#bdb4a6",
    opacity: 1,
    price: 70,
  },
  {
    id: "matte-black",
    name: "Matte black",
    front: "#2c2c30",
    back: "#202024",
    edge: "#45454b",
    opacity: 1,
    price: 70,
  },
  {
    id: "blush-pink",
    name: "Blush",
    front: "#f0c9d2",
    back: "#dcaab6",
    edge: "#c8919f",
    opacity: 1,
    price: 75,
  },
  {
    id: "mist-blue",
    name: "Mist blue",
    front: "#cfe1e2",
    back: "#b1cacc",
    edge: "#95b3b5",
    opacity: 1,
    price: 75,
  },
  {
    id: "burlap",
    name: "Burlap",
    front: "#c6ad84",
    back: "#a98f68",
    edge: "#8b7452",
    opacity: 1,
    price: 90,
  },
  {
    id: "cellophane",
    name: "Cellophane",
    front: "#e8f2f4",
    back: "#d3e4e7",
    edge: "#ffffff",
    opacity: 0.34,
    price: 40,
  },
];

export function getMaterial(id: string): WrapMaterial {
  return WRAP_MATERIALS.find((m) => m.id === id) ?? WRAP_MATERIALS[0];
}

/* -------------------------------------------------------------------------- */
/* Ribbons                                                                      */
/* -------------------------------------------------------------------------- */

export interface Ribbon {
  id: string;
  name: string;
  color: string;
  /** Highlight down the middle of a satin loop. Absent for matte weaves. */
  sheen?: string;
  /** Ribbon width in real millimetres. */
  widthMm: number;
  /** Openwork edge, for lace. */
  lace?: boolean;
  price: number;
}

export const RIBBONS: Ribbon[] = [
  { id: "satin-cream", name: "Cream satin", color: "#e8dbc4", sheen: "#fbf4e6", widthMm: 22, price: 40 },
  { id: "satin-pink", name: "Pink satin", color: "#eeafc1", sheen: "#f8d5df", widthMm: 22, price: 40 },
  { id: "satin-red", name: "Red satin", color: "#b02334", sheen: "#d9556200", widthMm: 22, price: 45 },
  { id: "grosgrain-black", name: "Black grosgrain", color: "#26262a", widthMm: 20, price: 45 },
  { id: "jute-twine", name: "Jute twine", color: "#b99a6b", widthMm: 8, price: 25 },
  { id: "lace-white", name: "White lace", color: "#f4efe6", widthMm: 30, lace: true, price: 65 },
  { id: "none", name: "No ribbon", color: "transparent", widthMm: 0, price: 0 },
];

export function getRibbon(id: string): Ribbon {
  return RIBBONS.find((r) => r.id === id) ?? RIBBONS[0];
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                       */
/* -------------------------------------------------------------------------- */

export interface WrapStyleDef {
  id: WrapStyle;
  name: string;
  description: string;
  /**
   * Collar width as a multiple of the flower mass half-width.
   *
   * At or above 1 for the styles that are meant to hold the bouquet, so the
   * outermost flowers sit over the paper rather than beside it. Below 1 the
   * paper is narrower than the mass, and a flower on the edge ends up floating
   * clear of the wrap with its stem hidden behind the collar — reading as a
   * flower that belongs to nothing.
   */
  collarSpread: number;
  /** How far up the flower mass the collar's side points reach, 0 to 1. */
  collarRise: number;
  /** Base width at its widest, as a fraction of the collar half-width. */
  baseSpread: number;
  /** How far down toward the bottom of the canvas the base reaches, 0 to 1. */
  baseHeight: number;
  /** 0 = flat bottom it can stand on, 1 = folded to a point. */
  taper: number;
  price: number;
}

export const WRAP_STYLES: WrapStyleDef[] = [
  {
    id: "round",
    name: "Round",
    description: "A wide fan collar on a base it can stand in.",
    collarSpread: 1.02,
    collarRise: 0.42,
    baseSpread: 0.52,
    baseHeight: 0.74,
    taper: 0,
    price: 80,
  },
  {
    id: "cornet",
    name: "Cornet",
    description: "Tall cone, points flaring at the corners.",
    collarSpread: 0.94,
    collarRise: 0.66,
    baseSpread: 0.38,
    baseHeight: 0.88,
    taper: 0.22,
    price: 80,
  },
  {
    id: "sleeve",
    name: "Sleeve",
    description: "One sheet, folded to a point.",
    collarSpread: 0.8,
    collarRise: 0.3,
    baseSpread: 0.26,
    baseHeight: 1,
    taper: 0.85,
    price: 50,
  },
  {
    id: "none",
    name: "Unwrapped",
    description: "Bare stems, tied as they are.",
    collarSpread: 0,
    collarRise: 0,
    baseSpread: 0,
    baseHeight: 0,
    taper: 0,
    price: 0,
  },
];

export function getWrapStyle(id: WrapStyle): WrapStyleDef {
  return WRAP_STYLES.find((s) => s.id === id) ?? WRAP_STYLES[0];
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                     */
/* -------------------------------------------------------------------------- */

export interface WrapShape {
  d: string;
  fill: string;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}

export interface Gradient {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: Array<{ offset: string; color: string; opacity?: number }>;
}

/**
 * The collar's rim, as numbers rather than as a path.
 *
 * The rim is a quadratic from one side point through a control at `top + dip`
 * to the other, so its height across the collar is `top + 2t(1-t)·dip` — lowest
 * in the middle, highest at the points. The engine's dome floor is shaped to
 * match, and `verify-engine` checks that no flower ends up under it.
 */
export interface CollarRim {
  centreX: number;
  halfWidth: number;
  top: number;
  dip: number;
}

/**
 * Height of the collar's rim at a given x. Past the side points, returns its top.
 *
 * `dip` is the drop at the centre, so this is `top + dip·(1 - u²)` with u the
 * fraction of the half-width. The drawn path reaches the same curve by putting
 * its control point at twice the dip — a quadratic passes only half way to its
 * control.
 */
export function rimYAt(rim: CollarRim, x: number): number {
  if (rim.halfWidth <= 0) return rim.top;
  const u = Math.min(1, Math.abs(x - rim.centreX) / rim.halfWidth);
  return rim.top + (1 - u * u) * rim.dip;
}

export interface WrapGeometry {
  gradients: Gradient[];
  back: WrapShape[];
  front: WrapShape[];
  tape: WrapShape[];
  ribbon: WrapShape[];
  /**
   * Where the wrap ends, so the stem bundle can be cut off inside it. Null when
   * the bouquet is unwrapped and the cut stems are meant to show.
   */
  baseBottomY: number | null;
  /** The collar's rim. Null when there is no collar to hide behind. */
  rim: CollarRim | null;
}

/** Floral tape is about 12mm wide on the reel. */
const TAPE_WIDTH_MM = 13;

/** Minimum collar half-width, so a single stem still gets wrapped. */
const MIN_COLLAR_MM = 55;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A flower's centre must clear the rim by this much before the paper reads as behind it. */
const RIM_CLEARANCE_PX = 6;

/**
 * The highest the collar's side points may rise without swallowing a flower.
 *
 * Writing the rim as a blend makes this exact. With the dip taken from the
 * middle, `rimY(u) = top·u² + rimMid·(1-u²)` — the rim is `top` at the side
 * points and `rimMid` at the centre — which is linear in `top`, so the
 * requirement `rimY(u) >= headY` solves directly for each flower:
 *
 *   top >= (headY - rimMid·(1-u²)) / u²
 *
 * Taking the largest gives the one number that keeps every flower in front of
 * the paper. Flowers near the middle are left out: there `u²` vanishes, the rim
 * is `rimMid` whatever `top` does, and `rimMid` already sits below the mass.
 *
 * Shaping the dome's floor like the rim was necessary but not sufficient — both
 * curves are `1 - u²`, but two curves of the same shape still cross if their
 * baselines are wrong, and the collar was sitting about ten pixels too high.
 */
function lowestPointClearing(
  placed: PlacedStem[],
  tx: number,
  collarHalf: number,
  rimMid: number,
): number {
  const MIN_U_SQUARED = 0.04;
  let required = -Infinity;

  for (const stem of placed) {
    const u = collarHalf > 0 ? Math.min(1, Math.abs(stem.headX - tx) / collarHalf) : 0;
    const uu = u * u;
    if (uu < MIN_U_SQUARED) continue;
    required = Math.max(required, (stem.headY + RIM_CLEARANCE_PX - rimMid * (1 - uu)) / uu);
  }

  return required === -Infinity ? -Infinity : required;
}

/**
 * Trims long decimals out of a path.
 *
 * The wrap's curves run through sin, cos and friends, whose last bits are
 * implementation-defined, so a raw path can differ between the server's render
 * and the browser's. Two decimal places is finer than a pixel and identical
 * everywhere.
 */
function tidy(shape: WrapShape): WrapShape {
  return {
    ...shape,
    d: shape.d.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100)),
    strokeWidth:
      shape.strokeWidth === undefined
        ? undefined
        : Math.round(shape.strokeWidth * 100) / 100,
  };
}

export function buildWrap(
  state: BouquetState,
  layout: Layout,
  placed: PlacedStem[],
): WrapGeometry {
  // Nothing to wrap. A collar and a bow tied around thin air reads as a bug,
  // and the empty stage is the clearer invitation to add a stem.
  if (placed.length === 0) {
    return {
      gradients: [],
      back: [],
      front: [],
      tape: [],
      ribbon: [],
      baseBottomY: null,
      rim: null,
    };
  }

  const style = getWrapStyle(state.wrapStyle);
  const material = getMaterial(state.wrapMaterial);
  const ribbon = getRibbon(state.ribbon);
  const { seed } = state;

  const tx = layout.tieX;
  const ty = layout.tieY;

  // The wrap is measured against the flowers, not the foliage: greens and
  // sprigs are meant to spill past the paper, so letting them widen the collar
  // would make it swallow the bouquet.
  const core = placed.filter((stem) => stem.item.category !== "green");
  const bounds = headMassBounds(core.length > 0 ? core : placed, layout);
  // How far the flowers reach from the tie point, not half the width of their
  // bounding box. The collar is centred on the tie, so a mass that leans to one
  // side needs a collar sized to its longer reach — measuring the box instead
  // left the outermost flower on the long side hanging off the paper.
  const massHalf = clamp(
    Math.max(layout.tieX - bounds.minX, bounds.maxX - layout.tieX),
    MIN_COLLAR_MM * layout.mmToPx,
    layout.width * 0.46,
  );
  const massTop = bounds.minY;
  const massBottom = Math.min(bounds.maxY, ty);
  const massHeight = Math.max(1, massBottom - massTop);

  // Side points rise beside the flowers; the rim between them dips below the
  // bottom of the mass, which is what keeps the middle of the bouquet clear of
  // paper instead of buried under it.
  const collarHalf = massHalf * style.collarSpread;
  const rimMid = massBottom + (ty - massBottom) * 0.24;
  const collarTop = Math.min(
    rimMid - 1,
    Math.max(massBottom - massHeight * style.collarRise, lowestPointClearing(core, tx, collarHalf, rimMid)),
  );
  const collarHeight = Math.max(1, ty - collarTop);

  const baseHalf = collarHalf * style.baseSpread;
  const baseBottom = ty + (layout.height * 0.965 - ty) * style.baseHeight;
  const baseDrop = Math.max(1, baseBottom - ty);
  // At full taper the wrap folds to a point; at zero it stands on a flat foot.
  const footHalf = baseHalf * (1 - style.taper);

  const gradients: Gradient[] = [
    {
      id: "wrap-base-shade",
      x1: tx - baseHalf * 1.05,
      y1: ty,
      x2: tx + baseHalf * 1.05,
      y2: ty,
      stops: [
        { offset: "0%", color: material.edge },
        { offset: "22%", color: material.front },
        { offset: "62%", color: material.front },
        { offset: "100%", color: material.back },
      ],
    },
    {
      id: "wrap-collar-shade",
      x1: tx,
      y1: collarTop,
      x2: tx,
      y2: ty,
      stops: [
        { offset: "0%", color: material.front },
        { offset: "100%", color: material.back },
      ],
    },
  ];

  const back: WrapShape[] = [];
  const front: WrapShape[] = [];

  if (style.id !== "none") {
    back.push(...backSheet(tx, ty, collarHalf, massTop, massHeight, material, seed));
    front.push(
      ...baseBody(tx, ty, baseHalf, footHalf, baseBottom, baseDrop, style, material, seed),
    );
    front.push(
      ...frontCollar(tx, ty, collarHalf, collarTop, collarHeight, rimMid, material, seed),
    );
  }

  // Tape binds the stems at the neck, so it is sized to the neck — not to the
  // flower mass, which would have it sticking out either side of the wrap.
  const neckHalf = style.id === "none" ? massHalf * 0.16 : baseHalf * 0.54;
  const tape: WrapShape[] = state.hasTape ? [tapeBand(tx, ty, neckHalf, layout, seed)] : [];

  const ribbonShapes =
    ribbon.widthMm > 0 ? bow(tx, ty, neckHalf * 1.32, layout, ribbon, seed) : [];

  return {
    gradients: gradients.map((gradient) => ({
      ...gradient,
      x1: Math.round(gradient.x1 * 100) / 100,
      y1: Math.round(gradient.y1 * 100) / 100,
      x2: Math.round(gradient.x2 * 100) / 100,
      y2: Math.round(gradient.y2 * 100) / 100,
    })),
    back: back.map(tidy),
    front: front.map(tidy),
    tape: tape.map(tidy),
    ribbon: ribbonShapes.map(tidy),
    baseBottomY: style.id === "none" ? null : baseBottom,
    rim:
      style.id === "none"
        ? null
        : {
            centreX: tx,
            halfWidth: collarHalf,
            top: collarTop,
            dip: Math.max(collarHeight * 0.16, rimMid - collarTop),
          },
  };
}

/**
 * The sheet behind the flowers. Its top edge arcs up rather than down, so it
 * reads as paper standing up behind the mass instead of a second front collar.
 */
function backSheet(
  tx: number,
  ty: number,
  half: number,
  massTop: number,
  massHeight: number,
  material: WrapMaterial,
  seed: number,
): WrapShape[] {
  const w = half * 0.98;
  // Paper shows as two corners standing up behind the flowers, with the sheet
  // dipping between them — not as a wall filling the space behind the bouquet.
  const t = massTop + massHeight * 0.3;
  const height = Math.max(1, ty - t);
  const lean = randSigned(seed, 0, "wrap-lean") * w * 0.05;

  const d = [
    `M ${tx - w * 0.28} ${ty}`,
    `C ${tx - w * 0.95} ${ty - height * 0.45} ${tx - w} ${t + height * 0.3} ${tx - w + lean} ${t}`,
    `Q ${tx + lean * 0.5} ${t + height * 0.42} ${tx + w + lean} ${t}`,
    `C ${tx + w} ${t + height * 0.3} ${tx + w * 0.95} ${ty - height * 0.45} ${tx + w * 0.28} ${ty}`,
    "Z",
  ].join(" ");

  return [
    { d, fill: material.back, opacity: material.opacity },
    {
      d,
      fill: "none",
      stroke: material.edge,
      strokeWidth: 2,
      opacity: material.opacity * 0.8,
    },
  ];
}

/**
 * The collar in front of the stems. Its rim dips in the middle, which is what
 * lets the flowers at the centre of the bouquet sit proud of the paper.
 */
function frontCollar(
  tx: number,
  ty: number,
  half: number,
  top: number,
  height: number,
  rimMid: number,
  material: WrapMaterial,
  seed: number,
): WrapShape[] {
  // The rim's lowest point is placed below the flowers rather than at a fixed
  // fraction of the collar, so tall bouquets do not end up hidden behind paper.
  const dip = Math.max(height * 0.16, rimMid - top);
  const d = [
    `M ${tx - half * 0.3} ${ty}`,
    `C ${tx - half * 0.9} ${ty - height * 0.5} ${tx - half} ${top + height * 0.2} ${tx - half} ${top}`,
    // Control at twice the dip: a quadratic passes half way to its control, so
    // this is what actually lands the middle of the rim at `top + dip`. It was
    // reaching only half that, which is why the paper kept swallowing flowers
    // the arithmetic said it should clear.
    `Q ${tx} ${top + dip * 2} ${tx + half} ${top}`,
    `C ${tx + half} ${top + height * 0.2} ${tx + half * 0.9} ${ty - height * 0.5} ${tx + half * 0.3} ${ty}`,
    "Z",
  ].join(" ");

  // Folds radiating from the tie, which is what makes wrapped paper read as
  // gathered rather than as a flat shape.
  const folds: WrapShape[] = [0, 1, 2, 3].map((i) => {
    const t = (i + 0.5) / 4;
    const x = tx - half + half * 2 * t;
    const wobble = randSigned(seed, i, "wrap-fold") * half * 0.06;
    return {
      d: `M ${tx + (x - tx) * 0.12} ${ty} Q ${tx + (x - tx) * 0.7 + wobble} ${
        ty - height * 0.55
      } ${x + wobble} ${top + dip * (1 - Math.abs(t - 0.5) * 2) * 0.8}`,
      fill: "none",
      stroke: material.edge,
      strokeWidth: 1.6,
      opacity: material.opacity * 0.45,
    };
  });

  return [
    { d, fill: "url(#wrap-collar-shade)", opacity: material.opacity },
    ...folds,
    { d, fill: "none", stroke: material.edge, strokeWidth: 2.2, opacity: material.opacity * 0.9 },
  ];
}

/** The body of the wrap below the tie: cylinder, cone or folded point. */
function baseBody(
  tx: number,
  ty: number,
  half: number,
  foot: number,
  bottom: number,
  drop: number,
  style: WrapStyleDef,
  material: WrapMaterial,
  seed: number,
): WrapShape[] {
  // The ribbon pinches the paper at the tie, so the base starts narrow at the
  // neck and opens out below it. That waist is what separates a wrapped
  // bouquet from a flowerpot.
  const neck = half * 0.54;
  const shapes: WrapShape[] = [];

  if (style.taper > 0.6) {
    // Folded to a point: two sides meeting at the tip.
    const tip = tx + randSigned(seed, 0, "wrap-tip") * half * 0.25;
    const d = [
      `M ${tx - neck} ${ty}`,
      `C ${tx - half} ${ty + drop * 0.22} ${tip - half * 0.5} ${bottom - drop * 0.3} ${tip} ${bottom}`,
      `C ${tip + half * 0.5} ${bottom - drop * 0.3} ${tx + half} ${ty + drop * 0.22} ${tx + neck} ${ty}`,
      "Z",
    ].join(" ");
    shapes.push({ d, fill: "url(#wrap-base-shade)", opacity: material.opacity });
    shapes.push({
      d,
      fill: "none",
      stroke: material.edge,
      strokeWidth: 2,
      opacity: material.opacity * 0.85,
    });
    return shapes;
  }

  // Standing base: sides open out from the neck and settle on a flat foot.
  const footY = bottom;
  const d = [
    `M ${tx - neck} ${ty}`,
    `C ${tx - half * 0.92} ${ty + drop * 0.4} ${tx - foot * 1.02} ${footY - drop * 0.34} ${tx - foot} ${footY}`,
    `L ${tx + foot} ${footY}`,
    `C ${tx + foot * 1.02} ${footY - drop * 0.34} ${tx + half * 0.92} ${ty + drop * 0.4} ${tx + neck} ${ty}`,
    "Z",
  ].join(" ");
  shapes.push({ d, fill: "url(#wrap-base-shade)", opacity: material.opacity });

  // The elliptical lip where the base meets the surface it stands on.
  shapes.push({
    d: `M ${tx - foot} ${footY} A ${foot} ${foot * 0.16} 0 0 0 ${tx + foot} ${footY}`,
    fill: "none",
    stroke: material.edge,
    strokeWidth: 2,
    opacity: material.opacity * 0.7,
  });

  // Two creases down the cone.
  for (const side of [-1, 1]) {
    shapes.push({
      d: `M ${tx + side * neck * 0.45} ${ty} Q ${tx + side * half * 0.5} ${
        ty + drop * 0.5
      } ${tx + side * foot * 0.55} ${footY}`,
      fill: "none",
      stroke: material.edge,
      strokeWidth: 1.4,
      opacity: material.opacity * 0.4,
    });
  }

  shapes.push({
    d,
    fill: "none",
    stroke: material.edge,
    strokeWidth: 2,
    opacity: material.opacity * 0.85,
  });
  return shapes;
}

/** A band of floral tape across the bind, sitting slightly off square. */
function tapeBand(tx: number, ty: number, half: number, layout: Layout, seed: number): WrapShape {
  const h = spriteWidthPx(TAPE_WIDTH_MM, layout.width, 1);
  const w = half * 1.15;
  const tilt = randSigned(seed, 0, "tape-tilt") * 5 - 3;
  const rad = (tilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corner = (dx: number, dy: number) =>
    `${(tx + dx * cos - dy * sin).toFixed(2)} ${(ty + dx * sin + dy * cos).toFixed(2)}`;

  return {
    d: `M ${corner(-w, -h / 2)} L ${corner(w, -h / 2)} L ${corner(w, h / 2)} L ${corner(
      -w,
      h / 2,
    )} Z`,
    fill: "#3d5a34",
    opacity: 0.92,
  };
}

/**
 * The bow: a band round the neck, two loops, two notched tails and a knot.
 *
 * Everything is sized from the ribbon's real width, so jute twine ties a small
 * tight bow and 30mm lace ties a broad one without either being hand-tuned.
 * The notch cut into the end of each tail is the detail that makes a ribbon
 * read as ribbon rather than as a strip of colour.
 */
function bow(
  tx: number,
  ty: number,
  neckHalf: number,
  layout: Layout,
  ribbon: Ribbon,
  seed: number,
): WrapShape[] {
  const w = spriteWidthPx(ribbon.widthMm, layout.width, 1);
  const loopW = Math.max(neckHalf * 0.82, w * 2.3);
  const loopH = loopW * 0.6;
  const tailLen = loopW * 1.55;
  const shapes: WrapShape[] = [];
  const laceEdge = ribbon.lace
    ? { stroke: ribbon.color, strokeWidth: 1.2, strokeDasharray: "3 3" }
    : {};

  // The band, pulled tight round the neck of the wrap.
  shapes.push({
    d: [
      `M ${tx - neckHalf * 1.1} ${ty - w * 0.62}`,
      `Q ${tx} ${ty - w * 0.02} ${tx + neckHalf * 1.1} ${ty - w * 0.62}`,
      `L ${tx + neckHalf * 1.1} ${ty + w * 0.38}`,
      `Q ${tx} ${ty + w * 0.98} ${tx - neckHalf * 1.1} ${ty + w * 0.38}`,
      "Z",
    ].join(" "),
    fill: ribbon.color,
    opacity: ribbon.lace ? 0.85 : 0.96,
  });

  for (const side of [-1, 1] as const) {
    const spread = 1 + randSigned(seed, side + 1, "bow-loop") * 0.07;
    const lw = loopW * spread;

    // Loop: out and up from the knot, then back under itself.
    shapes.push({
      d: [
        `M ${tx} ${ty}`,
        `C ${tx + side * lw * 0.3} ${ty - loopH * 1.1} ${tx + side * lw} ${ty - loopH * 0.95} ${
          tx + side * lw * 0.96
        } ${ty - loopH * 0.2}`,
        `C ${tx + side * lw * 0.93} ${ty + loopH * 0.42} ${tx + side * lw * 0.3} ${
          ty + loopH * 0.18
        } ${tx} ${ty}`,
        "Z",
      ].join(" "),
      fill: ribbon.color,
      opacity: ribbon.lace ? 0.8 : 1,
      ...laceEdge,
    });

    // The crease where the loop folds back on itself.
    shapes.push({
      d: `M ${tx + side * w * 0.3} ${ty - w * 0.1} Q ${tx + side * lw * 0.55} ${
        ty - loopH * 0.3
      } ${tx + side * lw * 0.86} ${ty - loopH * 0.28}`,
      fill: "none",
      stroke: "#00000026",
      strokeWidth: w * 0.28,
    });

    if (ribbon.sheen) {
      shapes.push({
        d: `M ${tx + side * lw * 0.2} ${ty - loopH * 0.18} C ${tx + side * lw * 0.5} ${
          ty - loopH * 0.78
        } ${tx + side * lw * 0.86} ${ty - loopH * 0.68} ${tx + side * lw * 0.86} ${
          ty - loopH * 0.24
        }`,
        fill: "none",
        stroke: ribbon.sheen,
        strokeWidth: w * 0.3,
        opacity: 0.6,
      });
    }

    // Tail, falling from the knot and cut with a V at the end.
    const sway = randSigned(seed, side + 3, "bow-tail") * loopW * 0.2;
    const endX = tx + side * loopW * 0.52 + sway;
    const endY = ty + tailLen;
    shapes.push({
      d: [
        `M ${tx + side * w * 0.42} ${ty + w * 0.2}`,
        `C ${tx + side * loopW * 0.42} ${ty + tailLen * 0.4} ${
          tx + side * loopW * 0.3 + sway
        } ${ty + tailLen * 0.72} ${endX} ${endY}`,
        `L ${endX - side * w * 0.5} ${endY - w * 0.62}`,
        `L ${endX - side * w * 1.02} ${endY - w * 0.06}`,
        `C ${tx + side * loopW * 0.08 + sway} ${ty + tailLen * 0.68} ${
          tx + side * loopW * 0.12
        } ${ty + tailLen * 0.36} ${tx - side * w * 0.42} ${ty + w * 0.2}`,
        "Z",
      ].join(" "),
      fill: ribbon.color,
      opacity: ribbon.lace ? 0.82 : 0.94,
      ...laceEdge,
    });
  }

  // The knot, last so it sits over the loops and the tails.
  const k = w * 0.62;
  shapes.push({
    d: [
      `M ${tx - k} ${ty - k * 0.85}`,
      `Q ${tx} ${ty - k * 0.35} ${tx + k} ${ty - k * 0.85}`,
      `L ${tx + k * 0.86} ${ty + k * 0.95}`,
      `Q ${tx} ${ty + k * 0.45} ${tx - k * 0.86} ${ty + k * 0.95}`,
      "Z",
    ].join(" "),
    fill: ribbon.color,
  });
  shapes.push({
    d: `M ${tx - k} ${ty - k * 0.85} Q ${tx} ${ty - k * 0.35} ${tx + k} ${ty - k * 0.85}`,
    fill: "none",
    stroke: "#0000001f",
    strokeWidth: w * 0.16,
  });
  if (ribbon.sheen) {
    shapes.push({
      d: `M ${tx - k * 0.5} ${ty - k * 0.2} Q ${tx} ${ty + k * 0.12} ${tx + k * 0.5} ${ty - k * 0.2}`,
      fill: "none",
      stroke: ribbon.sheen,
      strokeWidth: w * 0.2,
      opacity: 0.55,
    });
  }

  return shapes;
}
