import { clusterFlorets, spriteWidthPx, type Layout, type PlacedStem } from "@/lib/engine";
import { rand } from "@/lib/rng";

/** Real stems are about 6mm across, and that is how they get sized here too. */
const STEM_WIDTH_MM = 6;

interface Props {
  placed: PlacedStem;
  layout: Layout;
  seed: number;
}

/**
 * Placeholder sprite: circles only, no images.
 *
 * The important part is the transform, not the drawing. The sprite is placed
 * with its anchor at the origin of a frame translated to the tie point and
 * rotated outward — exactly the frame a real PNG will be dropped into in step
 * 5. Swapping the circles for an <image> then changes what is drawn without
 * changing where anything sits.
 */
export function StemSprite({ placed, layout, seed }: Props) {
  const { item, axisLengthPx, widthPx, scale } = placed;
  const stemWidth = spriteWidthPx(STEM_WIDTH_MM, layout.width, scale);
  const florets = clusterFlorets(placed, seed);

  // A stem is not a ruler: bow it slightly, away from the tie point.
  const bow = (rand(seed, placed.n, "bow") - 0.5) * axisLengthPx * 0.09;
  const stemPath = `M 0 0 Q ${bow} ${-axisLengthPx * 0.55} 0 ${-axisLengthPx}`;

  return (
    <g
      transform={`translate(${layout.tieX.toFixed(2)} ${layout.tieY.toFixed(
        2,
      )}) rotate(${placed.rotationDeg.toFixed(2)})`}
      data-stem={item.id}
      data-ring={placed.ring}
      data-n={placed.n}
    >
      <path
        d={stemPath}
        fill="none"
        stroke={item.stemColor}
        strokeWidth={stemWidth}
        strokeLinecap="round"
      />
      {florets.length > 0 ? (
        <Sprig placed={placed} florets={florets} stemWidth={stemWidth} />
      ) : (
        <Bloom placed={placed} radius={widthPx / 2} />
      )}
    </g>
  );
}

/** A single-headed bloom: two concentric circles and a rim. */
function Bloom({ placed, radius }: { placed: PlacedStem; radius: number }) {
  const { item, axisLengthPx } = placed;
  return (
    <g transform={`translate(0 ${-axisLengthPx.toFixed(2)})`}>
      <circle
        r={radius}
        fill={item.headColor}
        stroke={item.accentColor}
        strokeWidth={radius * 0.06}
      />
      <circle r={radius * 0.44} fill={item.accentColor} opacity={0.85} />
      <circle
        r={radius * 0.72}
        fill="none"
        stroke={item.accentColor}
        strokeWidth={radius * 0.05}
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
          d={`M 0 ${branchOriginY.toFixed(2)} Q ${(floret.x * 0.4).toFixed(2)} ${(
            branchOriginY +
            (-axisLengthPx - branchOriginY + floret.y) * 0.6
          ).toFixed(2)} ${floret.x.toFixed(2)} ${(-axisLengthPx + floret.y).toFixed(2)}`}
          fill="none"
          stroke={item.stemColor}
          strokeWidth={stemWidth * 0.45}
          strokeLinecap="round"
          opacity={0.9}
        />
      ))}
      {florets.map((floret, i) => (
        <circle
          key={`f${i}`}
          cx={floret.x.toFixed(2)}
          cy={(-axisLengthPx + floret.y).toFixed(2)}
          r={floret.r.toFixed(2)}
          fill={item.headColor}
          stroke={item.accentColor}
          strokeWidth={floret.r * 0.14}
        />
      ))}
    </g>
  );
}
