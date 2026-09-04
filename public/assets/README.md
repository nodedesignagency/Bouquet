# Sprites

Sixteen transparent PNGs: red rose, white lily and pink carnation in four poses
each (front, three-quarter, side, bud), plus sunflower in three and a smaller
sunflower in one. Generated with Magnific and background-removed; see
`assets-manifest.json` at the repo root to trace any file back to the creation
it came from.

All are 1248 × 1872, RGBA. Filenames match the `src` of a catalog variant
exactly — that is how `derive-anchors` pairs a file to the entry it belongs to.

## After changing or adding a sprite

```bash
npm run derive-anchors   # rewrites anchors in data/catalog.json
npm run review           # rebuilds review.html so you can check them
```

Draw each flower **upright, head up, stem running down**, with the cut end of
the stem the lowest opaque thing in the image and fully inside the frame — if
the stem runs off the bottom edge the derived anchor is the crop, not the cut.

Resolution does not affect layout: sprites are drawn at
`(realWidthMm / 400) * canvasWidth * scale` pixels wide, so a 2048px rose and a
512px rose render identically.

## Known gap before sprites replace the circles

The artwork sits inside a lot of empty frame — the opaque content is 44–79% of
the image width depending on the pose. The sizing rule maps `realWidthMm` onto
the sprite, so drawing a frame naively would make a 75mm rose read as 33mm.
`review.html` reports the fill percentage and the resulting apparent size per
variant. Fix by cropping the PNGs to their content box, or by recording the box
in the catalog and having the renderer scale by it. Either way it is step 5 work,
and step 5 has not been done.
