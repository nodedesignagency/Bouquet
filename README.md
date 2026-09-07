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
sprite width on screen = (realWidthMm / windowWidthMm) * canvasWidth * scale
```

The canvas is a window onto the real world, 400mm across unless the bouquet
needs more. A 180mm sunflower is 2.4× a 75mm rose on screen because that is what
it is in life, whatever the window is and whatever resolution the artwork
happens to be. The catalog's millimetre figures come from the reference size
table; the ruler under the stage is the real one. `scale` is the term the rule
leaves free, and it is where perspective across the rows lives, and where a
sprig of gypsophila broken to fit its gap lives.

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
  radius. Read as a plan view — a map of the bunch seen from above — which is
  what it is.
- **Each stem's anchor sits on the tie point**, and the sprite rotates about it
  so the head fans away. The rotation and the on-screen stem length are *solved*
  from the head position the arrangement asks for, so both statements stay true
  at once: every anchor is on the tie point, and every head is where it belongs.

### Composition

`lib/compose.ts` decides where every stem actually goes. It is a separate
problem from the engine's structure — which row a stem stands in, how deep the
bouquet is, how big each head is drawn — and running the two together is what
made the old arrangement read as an arrangement rather than as a bouquet: every
stem went to the one position its row had left for it, on an even pitch, and no
position was ever compared against another.

A florist does not do that. They put the biggest bloom down slightly off centre,
gather the next few around it, leave a space, fill the space with something
small, and stand back — repeatedly. What they are doing is generating a position
and **judging** it against everything already in their hand. So for each stem in
turn, 64 candidate positions are sampled and every one is scored against the
arrangement so far, and the best is taken.

**Nothing here is a collision test.** A bouquet with no collisions and nothing
else going for it is exactly the sparse, even, mirror-imaged thing this
replaced.

| the judgement | what it asks |
| --- | --- |
| `overlap` | is it attached to its neighbour, in the band that reads as a bouquet |
| `crowding` | is it swallowing anything, or being swallowed |
| `cluster` | are two or three of its own group within touching distance |
| `isolation` | is its nearest neighbour more than a head and a half away |
| `gap` | how empty was this spot before it went into it |
| `density` | does it move the local density toward full-in-the-heart, thin-at-the-rim |
| `silhouette` | is it inside the outline its role is allowed |
| `balance` | does the bouquet's weight end up near where it is meant to lean |
| `symmetry` | is it sitting where another head's reflection would be |
| `uniformity` | is its gap the same as everyone else's |
| `flatTop` | does its top edge line up with the others' |
| `edgeSize` | is a big bloom being hung off the rim |
| `gathers` | is it gathering round a flower the bouquet is built around |
| `blocksAnchor` | would it cover one |
| `floor`, `lean` | **hard**: nothing sinks into the wrap, nothing lies on its side |

The weights are named constants at the top of the file so they can be tuned
against a render rather than argued about.

- **Candidates are generated beside a neighbour**, at a distance chosen to land
  in the overlap band, three times in four. Sampling the whole face evenly, a
  late stem in a full bouquet has only a sliver of the face left that is any
  good, and forty even samples miss it — every one comes back ruinous and the
  best of a bad lot gets used. The rest are sampled free, because a bouquet also
  needs stems that start a group rather than joining one.
- **A candidate that has landed on something is nudged clear** rather than
  thrown away. Most positions in a full bouquet are nearly right, and a head
  that would swallow a neighbour is usually a finger's width from one that would
  not.
- **When every candidate is struck out**, the band is swept end to end at every
  height the row allows and the emptiest place wins. Taking the least ruinous of
  the ruinous ones is the worst answer there is.
- **The bouquet is built in small groups**, one per anchor, and a stem looks for
  its neighbours in its own group first and sits closer to them than the groups
  sit to each other. Evenly spread flowers look measured out; this is what makes
  some of them press together and leaves room between.
- **Every stem has its own preferred gap**, drawn from the seed. Scoring every
  candidate against one ideal collapses the variation straight back out: five
  identical roses all want the same gap, all get it, and the row is a picket
  fence.
- **The bouquet leans**, by up to a tenth of its width. A composition balanced
  exactly about its axis reads as a diagram of a bouquet.

### Rows

Front to back, a hand-tie is a small number of distinct courses: the front row
sits down on the rim of the wrap and hides everything behind it, and each row
back sits a little higher, a little smaller, and is partly covered by the row in
front.

So depth is **discrete**. A stem's *level* is a whole number, 0 is the front row,
and it settles three things at once:

| level | paint order | height | size |
| --- | --- | --- | --- |
| 0 | painted last, over everything | lowest, down on the rim | a little over life size |
| *n* back | painted earlier | a row step higher | a little under |

Because one number drives all three they cannot contradict each other. What is
drawn in front is always what sits lower; what shows above the rest is always
what is behind.

- **Rows are handed out from the heart of the bouquet outward, biggest first.**
  The heart is a little forward of the middle row, because in every reference
  photograph the statement flowers sit low and central with the rest rising
  behind and around them. A row at a time rather than a row at a stretch, or
  every big bloom in the bouquet lands in the same row with nothing to do but
  pile up. This replaced smallest-to-the-front, which kept every head visible by
  a simple rule — a head only ever stood behind a smaller one, so it always
  cleared it — but put the biggest bloom at the very back, and a photograph of a
  hand-tie does the opposite.
- **A big bloom is held to the middle of the face**, a small one is free to the
  edge, and that is a rule rather than a judgement to be weighed. Scored against
  the others it always lost — there is some combination of a good gap and a good
  cluster that outweighs it — and the biggest flower in the bouquet ended up
  furthest from the centre. It is also what keeps the small heads visible now
  that they are no longer all in front: a small head in a back row has the whole
  of the sides to be seen in.
- **How much of itself a head may have covered tightens as it grows.** The same
  fraction reads very differently at different sizes: a third of a carnation is
  twenty pixels and looks like flowers touching, a third of a lily is seventy and
  looks like one flower eating another.
- **"Big" is measured against the bouquet's own average, not its largest.** So a
  bouquet of one kind of rose has no big flowers in it, every head is the average
  one, and none of these rules fire. It is a MIXED bouquet that has a sunflower
  in it, and they are about the sunflower.
- **Depth scaling is subtle**: 1.06 at the front, 0.92 at the back, with a
  per-stem variation of a few percent on top and anchors a touch larger again. A
  steep falloff shrinks the back of the arrangement into a different bouquet
  behind the front of it, which is the opposite of depth: what you notice is the
  size, not the distance.
- **The row step is measured against the heads**, at 0.6 of a head width, so a
  little under half of every flower shows above the row in front of it. Measured
  in ring spacings — an RMS a few small heads drag down — a bouquet of roses and
  carnations stepped its rows further apart than a rose is wide, and the middle
  of every arrangement came out hollow.
- **A stem may stand off its row's line** by under a third of a step, so a row
  is a rhythm rather than a ruled line.
- **The front row follows the mouth of the wrap**, dipping toward the rim in the
  middle and sweeping back up at the sides — both, because the collar is drawn
  around the flowers and its mouth rises to a point at each side. A stem far out
  and low sits under a rising side point, and no collar can be drawn that both
  holds the bouquet and does not swallow it.

### Cut length and fit

- **Every stem is cut to the same length.** `stemLengthMm` barely varies across
  the catalog, because a florist cuts a hand-tie to length — only the rows decide
  which heads ride higher. Taking it from the artwork instead made it vary by
  66mm (the sprites are framed per flower, so a big bloom arrives with a
  proportionally longer stem) and threw single flowers far above the rest.
- **Rise is not scaled by the row.** A back-row flower sits where it does because
  of the dome, not because it is shorter; the 12% falloff governs size and
  nothing else.
- **Ring spacing** comes from the RMS head width of the *flowers*, which leans
  toward the big heads in the middle where the room is needed.
- **The window pulls back for a big bouquet.** Eleven sunflowers make an
  arrangement about 600mm across; held to a 400mm window it does not become a
  smaller bouquet, it becomes eleven full-sized sunflowers piled on top of each
  other, because positions can be squeezed and heads cannot. Every millimetre
  still converts through one number, so a 180mm sunflower is still 2.4× a 75mm
  rose whatever the window is. Measured over the **flowers** alone, so a stem of
  eucalyptus cannot change the scale of the whole bouquet; foliage running off
  the edge of the frame is what these photographs look like anyway.
- **And then out again to fill it.** The window is pulled back far enough for
  the biggest head the bouquet could possibly have at its widest point, which is
  a worst case the composition rarely reaches — so a bouquet ended up sitting in
  the middle of the canvas with a quarter of the frame empty around it and a
  wrap drawn to match. A final uniform zoom enlarges positions and head sizes
  together until something is about to leave the frame. Uniform is the point: it
  is the one operation that leaves every overlap the composition chose exactly
  as it chose it. It is the camera moving, not the bouquet. Measured over the
  flowers and filler only, so a stem of eucalyptus cannot rescale the bouquet.
- **How far a sprite reaches above its head is not half its width.** The artwork
  is framed per flower: a sunflower seen head-on carries its head a third of the
  way down its sprite, and the same sunflower at three quarters carries it nearly
  half way — two thirds of the sprite's width standing above the head rather than
  a third. Both the vertical fit and the fill zoom measure the real reach, or
  enlarging a bouquet to fill the frame cuts the tops off exactly those flowers.
- **The composition is born inside the frame.** Each role's reach and the row
  step are capped to what the canvas will take, so the fit passes are a backstop
  rather than a step. Composing wider and letting a fit squeeze the result is not
  the same thing at all: a fit scales positions and not head sizes, so a bouquet
  composed 30% too wide comes back with every overlap 30% deeper than the
  composition chose — which is exactly what it used to do. The three fits (width,
  height, lean) remain, and the vertical one shrinks only the part of the bouquet
  above the front row's line, so reining in a tall bouquet cannot push its front
  row into the paper.

### Layers and depth

Painted back to front, and **depth alone decides which stem lands over which**:

```
wrap-back · stems (back row → front row) · stem-bundle · wrap-front · tape · ribbon
```

The stems used to be four layers — greens, filler, focal, front-greens — emitted
in that order. Which meant a green in the front row was still painted behind a
flower in the back row, and a stem of gypsophila tucked into a gap was painted
behind every flower in the bouquet whichever gap it went into. The foliage
became a flat backdrop hung behind the arrangement rather than part of it: a
wall of gypsophila *behind* the roses instead of gypsophila *among* them.

So paint order comes from one number, `paintDepth`. Whole numbers are the rows;
the fraction is where a stem sits within its row's depth, and it is what a stem
*is* that sets it:

| | within its row |
| --- | --- |
| foliage | `+0.35` — behind the blooms of its own row |
| filler in a seam or at an edge | `+0.25` — behind them, a little nearer |
| filler in the triangle between two rows | `+0.45` — in front of the row behind, behind the row it is wedged into |
| a flower | `0` |
| foliage draping over the rim | `−0.45` — in front of the row it stands in |

Every offset is strictly inside ±0.5, which is what guarantees the thing that
matters: **a stem from a further row is never painted over one from a nearer
row**, whatever the two of them are.

**Every role is on the same depth ladder.** Each used to count its own rows,
which quietly meant they were not talking about the same thing: with twelve
flowers in four rows and four greens in two, a green in "the back row" stood one
step up while the flowers stood three, so the foliage that was supposed to be
behind the bouquet was in front of half of it. The roles differ in how they are
spread *along* the depth — flowers weighted to the front, foliage to the back,
filler wedged between rows — but the depth itself is one ladder.

**The depth treatment is graduated by row.** Brightness 0.94 and a 1px blur at
the very back, none at all in the front row, and the rows between get their
share — one shared SVG filter per depth band rather than per sprite. As a
fixed set of layers it could only ever say "foliage is far away", which is not
what depth is: a bouquet's back row of *flowers* is far away too.

**A sprig of gypsophila is broken to fit its gap.** A whole cut stem's spray is
half again as wide as a rose head, and a florist filling a bouquet does not push
the whole thing in — they break off what the space will take. Left whole, and
now that filler is drawn at its own depth rather than hidden behind everything,
six sprigs of it smother twelve roses. It is cut back to roughly what the gap
will take and never left wider than the bloom beside it. This is a *scale*,
which is the term the sizing rule already leaves free — it is where the
12%-per-row falloff lives too — so the sprig is still sized from its real
millimetres, just less of a sprig.

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

Each stem also carries a `depth`: how many rows forward or back it has been
moved by hand. The engine's own choice of row follows head size, which is right,
but "that rose belongs in front of the lily" is still a judgement it cannot make.

Moving a stem is a **move**, not a repaint. A row settles a stem's depth, its
height and its size together, so bringing a rose forward slides it over the lily
next to it *and* brings it down toward the rim of the wrap *and* draws it a
little larger — the three cannot come apart, which is the point. The rows are
then laid out again, so the stems it moves past shuffle along to make room
instead of being buried.

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

### Seeing the composition

The **Guides** toggle in the stage draws everything the composition was thinking
about, and it is the only honest way to tune a scoring function — you cannot
read one, you have to watch it choosing.

- every position that was considered for every stem, coloured by what it scored
- the outline each role was judged against
- the circle each head is treated as, with the anchors ringed in orange
- each stem's row, group and final score, and a `!` if every candidate for it
  was struck out and the fallback sweep had to run
- the line from each head back to the tie point, which is its stem

It is marked `data-guides` and the PNG export strips it, so it never reaches a
saved image.

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
