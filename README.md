# Bouquet

A bouquet builder. Pick stems, wrap them, price them, share them.

Next.js 14 (App Router), TypeScript, Tailwind. No runtime dependencies beyond
React and Next.

```bash
npm install
npm run dev        # http://localhost:3000
npm run verify     # engine and PNG-reader checks
npm run review     # rebuild review.html from the catalog and sprites
```

## The two rules

Everything else follows from these.

**1. Size from real millimetres, never from pixels.**

```
sprite width on screen = (realWidthMm / 400) * canvasWidth * scale
```

The canvas is a window onto 400mm of real world. A 180mm sunflower is 2.4× a
75mm rose on screen because that is what it is in life, and it stays 2.4× when
the artwork is swapped in, whatever resolution the artwork happens to be. The
catalog's millimetre figures come from the reference size table; the ruler under
the stage is the real one.

**2. One seed, no `Math.random` in the render path.**

The same seed and the same stems produce the same bouquet, down to the last
decimal. Randomness is *addressed*, not streamed: every jittered value is
`rand(seed, spiralOrdinal, channel)`, recomputed on demand rather than drawn
from a sequence. That is what lets you delete stem 3 without every stem after it
jumping to a new position. `scripts/verify-engine.ts` asserts it, including a
check that runs the placement path with `Math.random` replaced by a throw.

## The arrangement engine

`lib/engine.ts` turns state into geometry. It knows nothing about React, SVG or
images — it returns numbers, and the renderer draws them.

- **Tie point** at 50% across, 72% down.
- **Golden-angle spiral**: stem *n* sits at `n * 137.5°`, radius
  `ringSpacing * sqrt(n)`, plus seeded jitter of ±8° on the angle and ±6% on the
  radius. The same phyllotaxis a sunflower head uses, which is why it packs
  without visible rows.
- **Rings**: `ring = floor(sqrt(n))`, and scale drops 12% per ring outward.
- **Each stem's anchor sits on the tie point**, and the sprite rotates about it
  so the head fans away. The rotation and the on-screen stem length are *solved*
  from the head position the spiral asks for, so both statements stay true at
  once: every anchor is on the tie point, and every head is where the spiral
  wants it.
- **Placement order is not add order.** Focals take the middle, filler sits
  around them, greens land outside — the way a hand-tie is actually built up.
  The catalog currently carries five focals and no filler or greens, so those
  two layers render empty until foliage is added.
- **Ring spacing** comes from the RMS head width, which leans toward the big
  heads in the middle where the room is needed. For a single-flower bouquet RMS
  and mean agree exactly.
- **Fit pass**: two scalars, solved in closed form from a first placement pass,
  rein the spiral in so the mass stays in frame. Adding a thirtieth stem tightens
  the bouquet instead of pushing flowers off the canvas. Greens are allowed to
  overhang more than focals, because that is how these photographs are cropped.

### Layers

Painted back to front, and nothing but `LAYER_ORDER` decides the order:

```
wrap-back · greens · filler · focal · front-greens · stem-bundle · wrap-front · tape · ribbon
```

`wrap-back`, `greens` and `filler` sit behind the focal flowers and get
brightness 0.94 and a 1px blur, applied once as a shared SVG filter rather than
per sprite. Greens are split: a seeded minority are promoted to `front-greens`
so foliage reads over the top of the flowers.

### Placeholders

Stems are drawn as circles at their true footprint, so the millimetre sizing can
be judged directly, in colours sampled from the artwork. A stem whose
`bloomWidthMm` is much smaller than its `realWidthMm` — a sprig of baby's breath,
an orchid spray — is drawn as a cluster of florets laid out with the same
golden-angle spiral, one scale down. No catalog item does that today; the
current five are all single-headed.

Swapping in real PNGs means changing what `StemSprite` draws inside its
transform. Nothing about the arrangement moves.

## Wrap

`lib/wrap.ts` derives every shape from the tie point and the size of the flower
mass, so a collar closes around three stems as sensibly as it does around
thirty. Four styles (round, cornet, sleeve, unwrapped), seven papers including a
translucent cellophane, six ribbons. Ribbon geometry is sized from the ribbon's
real width in millimetres.

The wrap measures itself against the flowers, not the foliage; its rim dips
below the bottom of the mass so the middle of the bouquet is never buried; and
the base pinches at the tie where the ribbon pulls it in, then flares below.

## State, links and export

`BouquetState` is the single source of truth and is fully serialisable. Mutations
are pure functions returning a new state.

Share links carry the whole bouquet rather than an id, with runs of identical
stems collapsed:

```
?b=b1.8412.round.kraft-brown.satin-cream.1.lily-white:0*3,rose-red:1*5
```

Decoding is defensive — an unknown flower, paper or ribbon falls back rather
than throwing, so a link from an older build still opens.

`Save PNG` rasterises the SVG that is on the page at 2×, with the guides overlay
stripped. The stage background lives inside the SVG, so an export looks like the
screen.

## Sizing note

At 400mm across the frame, a fifteen-stem bouquet of 150mm lilies genuinely does
not fit without heavy overlap — such a bouquet is about half a metre wide in
life. The fit pass compresses it rather than letting it run off the canvas, and
the flowers pack tightly. That is the specified scale doing its job, not a bug;
real petals have gaps that solid placeholder circles do not.

## Sprites and anchors

`public/assets` holds sixteen transparent PNGs — red rose, white lily and pink
carnation in four poses each, sunflower in three, plus a smaller sunflower —
generated with Magnific and background-removed. `assets-manifest.json` records
the original creation, the cutout creation and the local filename for each, so
any asset can be traced back.

The app still draws placeholder circles: swapping them for the artwork is step
5, and step 5 has not been done. The circles' colours are now sampled from the
sprites, so a white lily reads white.

`scripts/derive-anchors.ts` reads every PNG in `public/assets`, finds the lowest
row containing an opaque pixel, takes that row's alpha-weighted horizontal
centroid, and writes `anchor: [x, y]` into `data/catalog.json`.

```bash
npm run derive-anchors
npm run derive-anchors -- --dry-run        # report without writing
npm run derive-anchors -- --threshold=32   # what counts as opaque, default 8
```

All sixteen variants currently have an anchor. It reports files no variant asks
for, variants still waiting on a file, and anything it could not read.

`npm run review` writes `review.html`: every variant on a transparency
checkerboard with its anchor drawn on top, its content bounding box, and the
size it will render at. Regenerate it after any run of `derive-anchors`.

The PNG reader is `scripts/lib/png.ts` — about a hundred lines over Node's own
zlib, covering every colour type and bit depth in the base spec plus palette
transparency, rather than a dependency for one build script. `npm run verify:anchors` checks it against PNGs it builds itself with
known anchors, so the artwork can be trusted the first time it lands.

## Build order

The brief's order, kept strictly, one commit per step:

1. Arrangement engine, placeholder circles, no images.
2. Catalog panel, add and remove stems.
3. Wrap styles and ribbon.
4. Price, PNG export, share URL.
5. Swap circles for real PNGs. **Not done.** The artwork and anchors are in
   place, but the renderer still draws circles. One thing to resolve first: the
   sprites sit inside a lot of empty frame — opaque content is 44–79% of the
   image width — so mapping `realWidthMm` onto the whole frame would make a 75mm
   rose read as 33mm. Crop to the content box, or record the box in the catalog
   and scale by it. `review.html` reports the shortfall per variant.

## Layout

```
app/            route, layout, global styles
components/     Builder shell, canvas, panels
lib/            engine, wrap, state, rng, pricing, share, export — all pure
data/           catalog.json
scripts/        derive-anchors, verification
public/assets/  sprites (empty until step 5)
```

Prices are whole rupees; `CURRENCY_SYMBOL` in `lib/pricing.ts` is the only place
money is formatted.
