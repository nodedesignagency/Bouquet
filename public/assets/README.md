# Sprites

Sixteen transparent PNGs: red rose, white lily and pink carnation in four poses
each (front, three-quarter, side, bud), plus sunflower in three and a smaller
sunflower in one. Generated with Magnific and background-removed; see
`assets-manifest.json` at the repo root to trace any file back to the creation
it came from.

RGBA, and **cropped tight to their content**. That matters: sprites are drawn at
`(realWidthMm / 400) * canvasWidth * scale` pixels wide, so any transparent
margin baked into a sprite is width the flower does not get. The cutouts arrived
with 21–56% of their frame empty, which would have rendered a 75mm rose at 33mm.

Filenames match the `src` of a catalog variant exactly — that is how
`derive-anchors` pairs a file to the entry it belongs to.

## Adding or replacing a sprite

```bash
npm run crop-sprites     # trim the transparent frame
npm run derive-anchors   # anchor, size and bloom row → data/catalog.json
npm run review           # rebuild review.html to check them
```

Draw each flower **upright, head up, stem running down**, with the cut end of
the stem the lowest opaque thing in the image and fully inside the frame — if
the stem runs off the bottom edge the derived anchor is the crop, not the cut.

Resolution is yours to choose and does not affect layout: a 2048px rose and a
512px rose render identically. Keep them large enough for a 2× PNG export.

Consistent framing between poses of the same flower helps but is not required —
the renderer slides each sprite along its axis so its bloom lands where the
engine asked, and bridges any gap with a drawn stem.
