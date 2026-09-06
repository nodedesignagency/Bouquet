import { clusterFlorets, px, spriteWidthPx, type Layout, type PlacedStem } from "@/lib/engine";
import { rand } from "@/lib/rng";

/** Real stems are about 6mm across, and that is how they get sized here too. */
const STEM_WIDTH_MM = 6;

interface Props {
  placed: PlacedStem;
  layout: Layout;
  seed: number;
}

/**
 * One stem, drawn in the frame the engine put it in.
 *
 * The transform is the whole point: the sprite's anchor sits at the origin of a
 * frame translated to the tie point and rotated outward, so the cut end of every
 * stem is on the tie point and the rotation alone fans the head away. That frame
 * was established with placeholder circles and has not changed since — swapping
 * in the artwork changed what is drawn inside it, not where anything sits.
 *
 * A variant with no artwork falls back to circles, so a catalog entry can be
 * added before its sprite has been drawn.
 */
export function StemSprite({ placed, layout, seed }: Props) {
  const [imageWidth, imageHeight] = placed.variant.size;
  const hasArtwork = imageWidth > 0 && imageHeight > 0;

  return (
    <g
      transform={`translate(${px(layout.tieX)} ${px(layout.tieY)}) rotate(${px(
        placed.rotationDeg,
      )})`}
      data-stem={placed.item.id}
      data-level={placed.level}
      data-n={placed.n}
    >
      {hasArtwork ? (
        <Sprite
          placed={placed}
          layout={layout}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
        />
      ) : (
        <Placeholder placed={placed} layout={layout} seed={seed} />
      )}
    </g>
  );
}

/**
 * The sprite itself.
 *
 * Width comes from millimetres, as everything does. Height follows from the
 * artwork's aspect ratio — which is shape, not size, and is the one thing the
 * PNG's pixel dimensions are allowed to decide.
 *
 * The sprite then slides along its own axis until its bloom sits exactly where
 * the golden-angle spiral asked for it. It has to: the artwork is framed per
 * flower, so a 65mm carnation arrives with a much shorter stem than a 150mm
 * lily, and taking each sprite's stem at face value would leave the small
 * flowers sunk into the wrap. Sliding down buries the cut end inside the wrap,
 * which is where a longer stem would go anyway. Sliding up lifts the cut end
 * off the tie point, so a stem is drawn in to bridge the gap — the same stem
 * the placeholder circles always drew.
 */
function Sprite({
  placed,
  layout,
  imageWidth,
  imageHeight,
}: {
  placed: PlacedStem;
  layout: Layout;
  imageWidth: number;
  imageHeight: number;
}) {
  const { variant, widthPx, axisLengthPx, item, scale } = placed;
  const height = widthPx * (imageHeight / imageWidth);

  // Distance from the cut end up to the middle of the bloom, as drawn.
  const naturalHead = ((variant.anchor[1] - variant.headY) / imageHeight) * height;
  const lift = axisLengthPx - naturalHead;

  const x = -(variant.anchor[0] / imageWidth) * widthPx;
  const y = -(variant.anchor[1] / imageHeight) * height - lift;

  return (
    <>
      {lift > 0 ? (
        <path
          d={`M 0 0 L 0 ${px(-lift)}`}
          stroke={item.stemColor}
          strokeWidth={px(spriteWidthPx(STEM_WIDTH_MM, layout.width, scale))}
          strokeLinecap="round"
        />
      ) : null}
      <image
        href={variant.src}
        x={px(x)}
        y={px(y)}
        width={px(widthPx)}
        height={px(height)}
        preserveAspectRatio="xMidYMid meet"
      />
    </>
  );
}

/** Circles at the sprite's true footprint, for a variant whose art is missing. */
function Placeholder({ placed, layout, seed }: Props) {
  const { item, axisLengthPx, widthPx, scale } = placed;
  const stemWidth = spriteWidthPx(STEM_WIDTH_MM, layout.width, scale);
  const florets = clusterFlorets(placed, seed);

  // A stem is not a ruler: bow it slightly, away from the tie point.
  const bow = (rand(seed, placed.n, "bow") - 0.5) * axisLengthPx * 0.09;

  return (
    <>
      <path
        d={`M 0 0 Q ${px(bow)} ${px(-axisLengthPx * 0.55)} 0 ${px(-axisLengthPx)}`}
        fill="none"
        stroke={item.stemColor}
        strokeWidth={px(stemWidth)}
        strokeLinecap="round"
      />
      {florets.length > 0 ? (
        <Sprig placed={placed} florets={florets} stemWidth={stemWidth} />
      ) : (
        <Bloom placed={placed} radius={widthPx / 2} />
      )}
    </>
  );
}

/** A single-headed bloom: two concentric circles and a rim. */
function Bloom({ placed, radius }: { placed: PlacedStem; radius: number }) {
  const { item, axisLengthPx } = placed;
  return (
    <g transform={`translate(0 ${px(-axisLengthPx)})`}>
      <circle
        r={px(radius)}
        fill={item.headColor}
        stroke={item.accentColor}
        strokeWidth={px(radius * 0.06)}
      />
      <circle r={px(radius * 0.44)} fill={item.accentColor} opacity={0.85} />
      <circle
        r={px(radius * 0.72)}
        fill="none"
        stroke={item.accentColor}
        strokeWidth={px(radius * 0.05)}
        opacity={0.5}
      />
    </g>
  );
}

/**
 * A sprig: one stem carrying many small blooms. The florets come from the
 * engine so their layout is seeded the same way the bouquet's is.
 */
function Sprig({
  placed,
  florets,
  stemWidth,
}: {
  placed: PlacedStem;
  florets: ReturnType<typeof clusterFlorets>;
  stemWidth: number;
}) {
  const { item, axisLengthPx, widthPx } = placed;
  const branchOriginY = -axisLengthPx + widthPx * 0.26;
  return (
    <g>
      {florets.map((floret, i) => (
        <path
          key={`b${i}`}
          d={`M 0 ${px(branchOriginY)} Q ${px(floret.x * 0.4)} ${px(
            branchOriginY + (-axisLengthPx - branchOriginY + floret.y) * 0.6,
          )} ${px(floret.x)} ${px(-axisLengthPx + floret.y)}`}
          fill="none"
          stroke={item.stemColor}
          strokeWidth={px(stemWidth * 0.45)}
          strokeLinecap="round"
          opacity={0.9}
        />
      ))}
      {florets.map((floret, i) => (
        <circle
          key={`f${i}`}
          cx={px(floret.x)}
          cy={px(-axisLengthPx + floret.y)}
          r={px(floret.r)}
          fill={item.headColor}
          stroke={item.accentColor}
          strokeWidth={px(floret.r * 0.14)}
        />
      ))}
    </g>
  );
}
