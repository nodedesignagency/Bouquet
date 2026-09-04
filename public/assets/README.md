# Sprites

Empty on purpose. Step 5 of the build order is the only step that puts images
here, and it has not been done — the renderer draws placeholder circles sized
from real millimetres instead.

## When the artwork arrives

1. Export one PNG per catalog variant, transparent background, non-interlaced.
2. Name each file exactly as the catalog's `src` says, minus the `/assets/`
   prefix — `rose-red-front.png`, `rose-red-three-quarter.png`, and so on. Run
   `npm run derive-anchors -- --dry-run` to list every variant still waiting on
   a file.
3. Draw each flower **upright, head up, stem running down to the bottom edge**,
   with the cut end of the stem the lowest opaque thing in the image. That point
   is what gets pinned to the tie point.
4. Run `npm run derive-anchors`. It finds the lowest opaque row in each PNG,
   takes the alpha-weighted horizontal centroid of that row, and writes the
   anchor into `data/catalog.json`.

Resolution is yours to choose and does not affect layout: every sprite is drawn
at `(realWidthMm / 400) * canvasWidth * scale` pixels wide, so a 2048px rose and
a 512px rose render identically. Keep them large enough for a 2x PNG export
(around 1024px on the long edge is plenty).
