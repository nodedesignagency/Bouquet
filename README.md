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
- **Each category is placed in its own band.** Look at a real hand-tie and the
  three roles do different jobs: flowers pack a dense disc, filler threads
  through the gaps between them, and greenery is not in the mass at all — it
  radiates out and up beyond it, sparse and reaching, and it is what gives a
  bouquet its outline. Running all three down one spiral could only ever make
  greens "the outermost flowers", a ring further out at the same height and
  density. So `CATEGORY_BAND` gives each one where it starts, how tightly it
  packs, how high it carries, how far it may splay, and how much the collar's
  floor pulls it down. A band starts at a multiple of the flower mass's own
  radius, so greenery follows the flowers outward as more are added.
- **The golden angle stays global.** Stem *n* sits at `n * 137.5°` across the
  whole bouquet however many bands there are, so no two stems anywhere point the
  same way. Only radius and ring come from the band — which is what separates
  the greenery from the flowers without disturbing the phyllotaxis. Ring, and so
  the 12% scale falloff, counts within the band too: greenery further out is not
  a shrunken flower, since the falloff is about depth inside a mass and each
  band is its own mass.
- **Ring spacing** comes from the RMS head width of the *flowers*, which leans
  toward the big heads in the middle where the room is needed. Measuring the
  flowers alone also means adding greenery, which lives in its own band further
  out, does not reflow the middle of the bouquet.
- **Every stem is cut to the same length.** `stemLengthMm` barely varies across
  the catalog, because a florist cuts a hand-tie to length — only the spiral
  decides which heads ride higher. Taking it from the artwork instead made it
  vary by 66mm (the sprites are framed per flower, so a big bloom arrives with a
  proportionally longer stem) and threw single flowers far above the rest.
- **Rise is not scaled by ring** either. An outer flower sits lower because it
  leans out, not because it is shorter; the 12% falloff governs size and nothing
  else.
- **The head mass is wider than it is tall.** The dome squash is well under 1 on
  both axes, which is what a hand-tie looks like from the front. Nearer 1, the
  spiral threw stems above the bouquet and buried others behind the collar.
- **The mass's floor is shaped like the collar's rim.** The downward drop tapers
  toward the sides by `1 - u²`, the same family as the rim's `2t(1-t)`, so the
  bottom of the flower mass is a smile rather than an arc bulging down. A
  uniform radial drop put the two curves on a collision course: a flower both low
  and off to one side landed under a rising side point and vanished behind the
  paper.
- **Fit pass**: three scalars, each solved in closed form from a first placement
  pass, rein the spiral in — one for the frame's width, one for its top, and one
  that keeps every stem's lean within 42°. Adding a thirtieth stem tightens the
  bouquet instead of pushing flowers off the canvas. Greens are allowed to
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

**Within a layer, paint order follows height.** Height and depth are the same
axis in a bouquet: the head mass is a dome seen from the front, so a flower on
the far side projects high in the frame and is partly hidden, and one on the near
side projects low and overlaps its neighbours. Sorting by `headY` makes that true
by construction — a flower cannot be drawn in front of another while sitting
above it. Ordering by ring instead broke the illusion, painting a small flower
flung high by the spiral over the big ones below it.

### Drawing a stem

`StemSprite` draws a PNG inside the frame the engine established. Width comes
from millimetres; height follows the artwork's aspect ratio, which is shape
rather than size and is the only thing a PNG's pixel dimensions decide.

The sprite then **slides along its own axis** until its bloom sits where the
spiral asked. It has to: the artwork is framed per flower, so a 65mm carnation
arrives with a proportionally shorter stem than a 150mm lily, and taking each
sprite's stem at face value sinks the small flowers into the wrap. Sliding down
buries the cut end inside the wrap, where a longer stem would go anyway; sliding
up lifts it off the tie point, so a stem is drawn in to bridge the gap — the same
stem the placeholder circles always drew.

A variant may also carry its own `widthMm`. A bud is not the size of the open
flower — an unopened rose is about half the width of a bloomed one — but every
pose was inheriting a single `realWidthMm`, so buds rendered full-size on
full-length stems and read as blobs rather than as buds. Foliage needs it too:
an arching eucalyptus spans twice what the same stem does upright.

**Arching foliage is mirrored to suit its side.** `arch-left` and `arch-right`
are the same stem flipped, and a frond that arches left belongs on the left of
the bouquet where it sweeps outward — the same sprite on the right arcs back
over the flowers instead. Which side a stem lands on is not known when it is
added, so the engine settles it at placement time from the sign of the stem's
offset. The stored variant still decides that a stem is an arching one rather
than an upright or a sprig.

A variant with no artwork falls back to those circles, so a catalog entry can be
added before its sprite exists. A stem whose `bloomWidthMm` is much smaller than
its `realWidthMm` — a sprig of baby's breath, an orchid spray — falls back to a
cluster of florets laid out with the same golden-angle spiral, one scale down.

## Wrap

`lib/wrap.ts` derives every shape from the tie point and the size of the flower
mass, so a collar closes around three stems as sensibly as it does around
thirty. Four styles (round, cornet, sleeve, unwrapped), seven papers including a
translucent cellophane, six ribbons. Ribbon geometry is sized from the ribbon's
real width in millimetres.

The wrap measures itself against the flowers, not the foliage; its rim dips
below the bottom of the mass so the middle of the bouquet is never buried; and
the base pinches at the tie where the ribbon pulls it in, then flares below.

The collar is sized to how far the flowers reach *from the tie point*, not to
half the width of their bounding box — it is centred on the tie, so a mass that
leans to one side needs a collar sized to its longer reach. Round and cornet
collars are then wide enough to sit under the outermost flowers; get this wrong
and a flower on the edge floats clear of the paper with its stem hidden behind
the collar, belonging to nothing.

Its rim is `top + dip·(1 - u²)`, and how high the side points may rise is solved
rather than chosen: writing the rim as a blend makes it linear in `top`, so
`rimY(u) >= headY` gives the exact ceiling for each flower and the largest wins.
`verify-engine` asserts no flower's centre ends up behind the rim, across several
recipes and seeds — that check found a long-standing bug on its first run, since
a quadratic Bézier passes only half way to its control point and the rim had
therefore been dipping half as far as every calculation assumed.

## State, links and export

`BouquetState` is the single source of truth and is fully serialisable. Mutations
are pure functions returning a new state.

Each stem also carries a `depth`, a manual override of where it sits in the
stack. The engine orders by height, which is right for the dome, but "that rose
belongs in front of the lily" is still a judgement it cannot make. Depth reorders
painting only: nothing moves in the arrangement when you change it.

Share links carry the whole bouquet rather than an id, with runs of identical
stems collapsed:

```
?b=b1.8412.round.kraft-brown.satin-cream.1.lily-white:0*3,rose-red:1*5
```

Decoding is defensive — an unknown flower, paper or ribbon falls back rather
than throwing, so a link from an older build still opens.

`Save PNG` rasterises the SVG that is on the page at 2×, with the guides overlay
stripped. The stage background lives inside the SVG, so an export looks like the
screen. Each sprite is inlined as a data URI first: an SVG rasterised through an
`<img>` loads in secure static mode and silently refuses to fetch anything
external, so without that the export comes back as an empty wrap.

## Sizing note

At 400mm across the frame, a fifteen-stem bouquet of 150mm lilies genuinely does
not fit without heavy overlap — such a bouquet is about half a metre wide in
life. The fit pass compresses it rather than letting it run off the canvas, and
the flowers pack tightly. That is the specified scale doing its job, not a bug;
real petals have gaps, which is why it reads better with the artwork in than it
did with solid circles.

## Sprites and anchors

`public/assets` holds twenty-eight transparent PNGs, generated with Magnific and
background-removed: five focals (red rose, white lily and pink carnation in four
poses each, sunflower in three, a smaller sunflower), baby's breath as filler,
and silver dollar eucalyptus and leatherleaf fern as greens — the foliage in
upright, arch-left, arch-right and sprig poses. `assets-manifest.json` records
the original creation, the cutout creation and the local filename for each, so
any asset can be traced back.

Two scripts turn raw artwork into something the renderer can place.

`scripts/crop-sprites.ts` trims the transparent frame off each sprite. The
cutouts arrived with 21–56% of their frame empty, and since the sizing rule maps
`realWidthMm` onto the sprite, that padding was width the flower did not get — a
75mm rose would have rendered at 33mm. Cropping makes "the sprite is
`realWidthMm` wide" true of the flower rather than of its packaging. It is safe
to re-run and leaves an already-tight sprite alone.

`scripts/derive-anchors.ts` then reads every PNG, finds the lowest row containing
an opaque pixel, takes that row's alpha-weighted horizontal centroid, and writes
`anchor: [x, y]` into `data/catalog.json`. It also records `size` (the sprite's
pixel dimensions, for the aspect ratio) and `headY` (the row the bloom's centre
sits on, so the renderer can put that bloom where the engine asked).

```bash
npm run crop-sprites                       # trim the frame; re-run safely
npm run derive-anchors                     # anchor, size and head row
npm run derive-anchors -- --dry-run        # report without writing
npm run derive-anchors -- --threshold=32   # what counts as opaque, default 8
npm run review                             # rebuild review.html
```

All sixteen variants currently have an anchor. It reports files no variant asks
for, variants still waiting on a file, and anything it could not read.

`npm run review` writes `review.html`: every variant on a transparency
checkerboard with its anchor and bloom row drawn on top, its content box, and
the size it renders at. Regenerate it after any run of `derive-anchors`.

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
5. Swap circles for real PNGs. Done. Circles remain as the fallback for any
   variant whose artwork has not been drawn yet.

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
