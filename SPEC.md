# ShaderLab — spec v0.1

Working name. Rename freely; nothing depends on it yet.

A generator for animated shader backgrounds for the Portfolio carousel cards, with a gallery grid for previewing and choosing, an export path into Portfolio, and (later) a compose mode for layering images and code over a finished shader.

Written by the Planner from the Builder's inventory and the Critic's direction read, 2026-10-28, then revised after the Critic's review (lineage, caption mask, luminance floor, circular loop, field scale replaces angle, Export as a sheet, Rail view). Open questions are in section 3; nothing in section 4 is final until they are answered.

---

## 1. Goal

**End of day (2026-10-28):** six exported card backgrounds sitting in the Portfolio carousel, one per project, that read as one family and are each unmistakably that project's.

**Ongoing:** a tool Joe keeps using to make, tune, and compose card art, with presets that live in git.

## 2. Direction (Critic, adopted)

Revised 2026-10-28, third pass. Joe found the noise-field model too noisy and too complex: "less noise overall and only a few stages I could customize... mainly control the overall hue and value of a few items... add some dimensionality if I wanted." The references in `reference/` (a navy field with one light bottom-right; a grey pleated field under a dark UI card) are each a dark surface, one or two soft lights, and an optional fine texture. The model is now **items with a hue and a value**, in five stages. Everything before this pass about noise fields, ramps-over-fields and ripple globals is withdrawn.

**The five stages.** Each is a short list of controls. A preset is these numbers and nothing else.

Fourth pass, after thirteen references landed in `reference/` (Polar's pleated monochrome, ElevenLabs' grainy multi-hue tiles with a perspective grid, a lavender cloud field, a prism streak on black, a navy field with one light, blurred daisies, a pink-blue-orange eclipse, a red glow on grey, a marbled pink-yellow swirl, and dusky photographic horizons under UI). What they share: **heavy film grain on every one**, a few very large soft masses of colour or shadow, two to four hues as often as one, light fields as often as dark, and one optional structure layer (pleats, a grid, a swirl, a streak). What none of them has: noise clouds, more than four masses, hard edges.

1. **Base.** One hue, one value, one chroma. Any value, light or dark: the lavender cloud field and the "Deep Layers" grey are as valid as the navy.
2. **Masses.** One to four soft masses. Each: a colour (picked directly from a swatch; stored as OKLCH), a value offset slider for nudging brightness, position (card units, may sit off-card), size, softness. Hue, value and chroma are never exposed as three separate sliders; Joe picks colours. A mass may be lighter or darker than the base; the dark blurred blob in Polar and NVIDIA is a mass with a low value. Masses composite in OKLab by mixing toward their colour weighted by their falloff, in order, so a dark mass over a light one works. All personality lives here.
3. **Texture.** Grain amount, luminance-scaled, **static** (hashed per pixel from the seed, never per frame; Joe's call, and it keeps video exports small). A family toggle can animate it at half frame rate for a card that wants film flicker. **On by default and strong**; the references are film, not vector.
4. **Depth.** A stack of independent layers, each with on/off and an amount, in a fixed compositing order. Light, Curve, Parallax and Haze combine freely; of the structure layers (Swirl, Relief, Strokes) at most one is on per card, because no reference stacks two. A Grid layer (perspective wireframe, as on the middle ElevenLabs tile) was built and then cut by Joe on 2026-10-28:
   - **Light** (added 2026-11-02 from the Gradientora reference; the one idea taken from it). The masses define a height field: light masses rise, dark masses sink, Curve bows it, Relief and Strokes ridge it. A surface normal is derived from that field in the same fragment shader and shaded by one directional light from the family angle at a family elevation, with a wrapped Lambert so the back side dims rather than blacks out. Family dials: light angle, elevation, amount (0.1–0.3). Per card: height 0..1; at 0 the card is flat and looks as it did before. No 3D scene, no camera, no sphere, no water: the dark side of a mass is now the unlit side of a hill, which is what the NVIDIA and ElevenLabs tiles have. Target image: `reference/texture-silk-fold.webp` (2026-11-02), one smooth S-shaped fold in a surface lit from above, gold to red to indigo along it. Light plus a large, slow Swirl warp should reach it; the fold's crest is where the normal turns away from the light.
   - **Curve.** The base is a slightly bent surface; it bows the height field, so a mass reads as sitting on a sheet rather than floating.
   - **Parallax.** Each mass gets a distance; nearer masses drift more over the loop, farther less. Nothing moves at amount 0.
   - **Haze.** Value fades toward the base with distance from the nearest light mass, deepening the far side.
   - **Swirl.** A slow domain warp that drags the masses into marbled flow (the pink-yellow swirl reference). Amount is warp strength; it loops with the motion.
   - **Relief.** Fine pleats (Polar) as ridges in the height field, so the Light layer shades them; visible where lit. Frequency and twist as its own params.
   - **Strokes** ("painted grass", Joe's reference `reference/texture-painted-grass.webp`, 2026-11-02): long soft brush fibres running along one direction, like dry-brushed paint or long-exposure grass, that make the masses read as painted rather than airbrushed. Mechanism: a fine noise stretched hard along the stroke direction (anisotropy around 40:1), domain-warped by a low-frequency wave so the fibres undulate, applied as small lightness variation (±0.03 to ±0.08) and as low-amplitude ridges in the height field so the Light layer catches them. Params: direction (default the family angle, so strokes and light agree), length, density, amount. A structure option alongside Swirl and Relief, one per card. **Animated** (Joe, 2026-11-02): strokes move on the loop like everything else, never reversing: drift along the stroke direction (fibres slide as if combed by wind), sway (the undulation wave's phase advances so fibres bend and straighten), and breathing (the presence noise evolves so strokes fade in and out). One per-card dial, stroke motion 0..1, scaled by the global Motion dial; reduced motion freezes it with the rest. **Painted, not dragged** (Joe, 2026-11-03: "more like a painting; right now it feels like something dragged the paint across the whole canvas in one direction"). Strokes are **finite brush marks**, not infinite fibres: a jittered grid of cells, each holding one mark with its own centre, angle, length (tapered at both ends), width and lightness offset, with the fibre texture running inside the mark along its own axis. Marks overlap their neighbours and a mark's lightness leans toward the colour under it, so they read as paint laid on the field rather than scratched across it. Dials: size (mark length), density (cells per card width), taper, and **chaos** 0..1, the spread of mark angles around the stroke direction: 0 is every mark aligned (a combed look), 1 is ±90° (an impasto scatter). Marks may also lean toward following the field (perpendicular to the masses' slope, as a painter follows form) by a follow dial. The fibre blur runs along each mark's own axis.
   - **Shadow.** A pooled soft shadow in a rectangle where a UI layer will sit, with offset and spread. For previewing the two-asset composition; off on export unless asked.
5. **Finish** (Joe, 2026-10-28). Two post-process blurs over the composited field, each its own option with on/off, applied after Depth and before Texture so the grain stays crisp on top, as in the Pioneer and Omnichannel references:
   - **Motion blur.** Direction (angle), size (length in card widths), intensity (mix with the unblurred field). A directional multi-tap sample along the angle.
   - **Layer blur.** Size (radius) and intensity. A separable Gaussian in a second pass.
   Both run on a half-resolution intermediate for thumbnails and full resolution in Focus and export. Motion blur direction may be locked to the family's light angle or free per card.
6. **Motion.** Speed and loop length, global. Each mass drifts on a small circle (radius a family dial) so it never reverses. Reduced motion freezes at `stillTime`.

**Cohesive yet distinct.** The family locks grain, mass count range, mass size and softness range, which depth layers are on and their amount ranges, and motion. Each card is free in base colour, the masses' colours and values, and a seed. Six cards share one film stock and one way of placing masses; the colours are each project's own.

**Shuffle.** Every card has a seed. Shuffle re-rolls, from the seed, everything the family leaves free and anything not locked. Each item has a lock so a result Joe likes stays while the rest re-rolls. "Shuffle all" rolls every card with a different seed so no two match. Because it is seeded, a preset file reproduces exactly.

Joe's direction (2026-10-28): both the grainy-mass look and the structured look are options, and colour should be a random mix, not always a gradient. So the shuffle rolls three independent choices before it rolls numbers:

- **Colour mode**, one of: *mono* (one hue, masses vary in value only), *warm-cool* (two hues 120–180° apart), *triad* (three hues roughly 120° apart), *free* (each mass its own hue). Chroma per mass is rolled within the family cap; the *bold* flag, when the family allows it, raises the cap to 0.22 for one mass.
- **Coverage**, one of: *blend* (two to three large masses, softness 0.7–0.9; the gradient look), *block* (one or two smaller, firmer masses, softness 0.4–0.6, on a mostly flat base; the Polar and eclipse look), *flat* (a single off-card mass or none; the base and grain carry the card, and a structure layer is likely on).
- **Structure**, one of: none, Swirl, Relief, with none weighted roughly 40% and the rest equal.

Guardrails survive every mode: at least one dark or low-chroma mass unless coverage is *flat*, no more than three hues, chroma within the cap, L range within the tonal rules. A family dial, **variety** 0..1, scales how far the shuffle ranges from the family defaults, so a conservative family still shuffles.

**Tonal rules.** Nothing below L 0.12 or above L 0.97 in OKLCH, so neither black holes nor blown whites. Every card has at least 0.35 of L range between its darkest and lightest region, shown in the Rail, so there is always somewhere for a UI layer's shadow to read. `shadowColor` for Portfolio comes from the most saturated mass's colour.

**Caption mask.** A weak global mask (mix 0.5 toward a low-pass of the field) in the caption zone, switchable per card.

Refuse: the Stripe or Linear launch-tile look, whose real tells are more than three hues, chroma above 0.18, and no dark mass; noise clouds; more than four masses; vector-clean gradients with no grain; and animation that never rests. The Shuffle must never roll four bright masses on a dark base. What keeps this Joe's rather than a house style borrowed from ElevenLabs: one dark or low-chroma mass in every card, off-card placement, heavy grain, and mid-value bases. **Still at a glance, alive on a second look.**

**Centre and outliers (Critic, from all thirteen).** Centre of the set: the ElevenLabs tiles, the NVIDIA tile, "Deep Layers". Per-card options, not family: Polar's pleats and the swirl (the ElevenLabs grid was tried and cut). Kept out of the family: the prism streak (hard chromatic edge), the eclipse (four banded hues), the daisies (photographic content).

## 3. Questions and answers

Answered by Joe, 2026-10-28:

1. **Backdrop, always.** The shader sits under the product screenshot and caption. Export is a new layer beneath `card-*.png`, never a replacement. The caption mask is therefore on for every card that carries a caption.
2. **The image is input to a creative-direction system.** Not a picture to show, and not only a palette source. The family (field, grammar, globals) is the direction; the uploaded image is the input it is applied to; the result is a variation that is cohesive with the family and individual to the input. Mechanically: the image supplies both the ramp (extracted) and structure (its luminance drives and is displaced by the field), and a **fidelity** dial sets how much of the source survives, from "character only" to "recognisable". See section 4, Image model.
3. **Standalone.** ShaderLab exports assets for the carousel or any other component. It never reaches into Portfolio.
4. **Both runtime paths, with performance made legible.** Exported video is the guaranteed path. A live runtime is a second, optional path, and the Builder reports measured cost before it is used anywhere. See section 9.
5. **The timeline defines how the finished product behaves wherever it is placed.** It never adjusts the host. So the states and their transitions are *data in the preset* that a consuming component interprets, not code in the host. See section 6, Portable behaviour.

6. **Character only.** Joe confirmed: by default the source image's character (hue distribution, tonal shape, large-scale structure) survives and its content does not. The fidelity dial can push a single card further, but the family default and the ramp extraction are built for character, not legibility.

Still open:

7. **The inspiration image.** It has not arrived. Drop it in `ShaderLab/reference/`; the first family is tuned from it.

## 4. Decisions (recommended, pending section 3)

| Area | Decision | Why |
|---|---|---|
| Home | Standalone Vite + React + TS repo, `~/Projects/ShaderLab`, port 5176 | Keeps Portfolio's morph untouched; the tool outlives the thumbnails |
| Rendering | Raw WebGL2 fragment shader in a `useShaderCanvas` hook. No three.js, no R3F | Fullscreen quad plus uniforms; Bitmania already proves the raw path in this codebase |
| Field (`masses@1`) | Base colour in OKLab; up to four masses, each a **plateau falloff** `w = exp(-0.5 · (max(d − 0.25·size, 0) / size)^k)` with k from softness (0.4 → 4, 0.9 → 1.6), so a mass reaches its own colour over an area rather than at a point; `d` from the mass's position after Curve and Swirl warp the coordinate; colour = `mix(colour, massColour, w)` in order; then Haze, Relief (pleats weighted by `4w(1−w)` of the nearest light mass so they live in the penumbra, frequency 85 per card width), Shadow, grain, caption mask, gamut-map to sRGB. No noise field, no ramp texture. Parallax scales each mass's loop circle by its distance | Plain Gaussians averaged three masses into mud; plateaus keep the base visible and the masses as distinct lobes, as every reference does |
| Palette | Kept in `src/palette/` for OKLCH math and gamut mapping only. The ramp texture is not used by `lights@1` | The gradient-map idea survives as base plus light colours |
| Thumbnails | One shared offscreen WebGL2 context renders each preset and blits to a 2D canvas per cell; idle cells show a cached PNG | Browsers cap live contexts at roughly 16 |
| Controls | DialKit 2.0.2, pinned exactly. Panel derived from the shader's uniform manifest | Portfolio already uses it; panel and preset cannot drift |
| Gallery expand | Motion `layoutId` on a static CSS grid; one canvas stays alive and resizes across the transition | A second WebGL context recompiles; the morph in Portfolio failed with layoutId only because of its live scale transform |
| Loop | Time traces a circle in noise space (two offset 3D samples or a 4D sample) with period `loop.seconds`, default 24s. Never raw `t`, and never `sin` phases | Seamless and directional; sine phases make every motion a pendulum that visibly reverses, and 8s is too short for "still at a glance" |
| Reduced motion | Freeze `u_time` at the preset's `stillTime`, render one frame | Matches how the carousel pauses autoplay |
| Export | PNG at 2× via offscreen render (guaranteed). WebM via WebCodecs `VideoEncoder` + `webm-muxer`, frame-exact (Chromium; best-effort on Safari). GIF last, if ever | Portfolio's `VideoLoop` takes video; MediaRecorder drops frames |
| Preset | One JSON per preset (schema below), committed; copied into `Portfolio/public/shaders/` | Diffable, shareable, versioned |
| Aura | `shadowColor` is derived from the ramp's light stop. The glow samples rendered pixels, so it is whatever the lit region produces | This is why the tonal rules are rules, not preferences |
| Image model | Upload → (1) ramp extracted from the image (see Image grammar), editable afterwards; (2) image luminance uploaded as `u_image`, blurred and mixed with the noise field; (3) the field displaces the image sample so structure drifts with the loop. One dial, **fidelity** 0..1, drives blur radius, mix weight and displacement together. Fidelity never changes colour, only structure | The image says where the light is, never what the picture is |
| Runtime, path A | Export: poster PNG plus WebM loops for idle and active only. Hover is a 0.3s brightness lift and stays the host's job (its existing scale spring). Portfolio's `VideoLoop` already stacks clips and crossfades | Zero runtime cost; six hover clips for a brightness change is the wrong trade |
| Runtime, path B | Live: a small `ShaderCard` component (preset in, canvas out, `state` prop drives transitions) published from this repo as a package Portfolio or any site can import. Ships behind a flag with path A as fallback | Responds to state in real time; costs GPU and battery (section 9) |
| Behaviour | Preset carries `states` (per-state uniform overrides and transition timing). Both runtime paths read the same definition: path A bakes one clip per state, path B animates between them | The timeline is portable data, never host code |

### Preset schema

```json
{
  "schema": 2,
  "id": "wildflower",
  "shader": "lights@1",
  "canvas": { "width": 613, "height": 408, "dpr": 2 },
  "loop": { "seconds": 24, "fps": 30, "stillTime": 6.0 },
  "seed": 3,
  "base":   { "hue": 30, "value": 0.2, "chroma": 0.03, "locked": false },
  "lights": [
    { "hue": 40, "value": 0.8, "chroma": 0.14, "x": 1.15, "y": 0.85, "size": 0.9, "softness": 0.7, "distance": 0.5, "locked": false },
    { "hue": 60, "value": 0.5, "chroma": 0.08, "x": 1.3,  "y": 0.1,  "size": 0.5, "softness": 0.8, "distance": 1.0, "locked": false }
  ],
  "texture": { "grain": 0.0 },
  "depth": {
    "curve":    { "on": false, "amount": 0.3 },
    "parallax": { "on": false, "amount": 0.5 },
    "haze":     { "on": true,  "amount": 0.4 },
    "swirl":    { "on": false, "amount": 0.2 },
    "relief":   { "on": false, "amount": 0.15, "frequency": 85, "twist": 6 },
    "shadow":   { "on": false, "amount": 0.5, "rect": [0.08, 0.1, 0.84, 0.8], "offset": 0.03, "spread": 0.1 }
  },
  "captionMask": true,
  "image": { "src": "/inputs/wildflower.jpg", "fidelity": 0.35, "rampSource": "extracted" },
  "states": {
    "idle":   { "uniforms": {}, "loop": true },
    "hover":  { "uniforms": { "u_exposure": 0.12 }, "transition": { "duration": 0.3, "ease": "out", "durationOut": 0.45 } },
    "active": { "uniforms": { "u_exposure": 0.25, "u_contrast": 0.85 }, "transition": { "duration": 0.6, "ease": "inOut", "durationOut": 0.9 } }
  },
  "meta": { "name": "Bloom", "project": "wildflower", "created": "2026-10-28" }
}
```

Hue is degrees in OKLCH, value is OKLCH L, chroma is OKLCH C. Positions are card units (x 0..1.5, y 0..1 for 613×408; lights may sit outside). `image` is `null` for a card built from the family alone. `states.idle` is the base; other states are deltas on top of it (hover: every light's value +0.08; active: +0.15 and chroma ×0.9), so a preset with no `states` block still works. Transition timing uses Motion's vocabulary so path B can hand it straight to `animate()`. `family.json` holds the locks and bounds the shuffle respects: base value range, light count, size range, position bounds (right side), drift radius, which depth layers are on, and their amount ranges.

### Projects and backgrounds (Joe, 2026-11-06: "the tooling can be consistent for groups of cards while I have the ability to push and pull that differentiation myself")

The cards were too alike because one family set the motion, the light and the bounds for every card, with one card per project and one Variety dial for all of them. Similarity is now Joe's call, set per project, at three levels, each inheriting from the one above and each overridable below:

- **House** (`presets/family.json`, the old family): optional shared rules. Its new **House pull** (`housePull`, 0..1, default 0.5) says how strongly projects are drawn toward the house. At 0, projects are independent.
- **Project** (`presets/projects/<id>.json`, one per Portfolio project): that project's look, a `style` holding the same stages a card has (base, masses, texture, depth, modes), plus **Spread** (`spread`, 0..1, default 0.4), how far a new background or a shuffle may stray from the style, and `primary`, the background that ships.
- **Background** (`presets/<id>.json`, today's preset file plus `project` and `overrides`): one card. It stays a full preset, so the renderer, the pack and export see resolved values. `overrides` lists the stage paths it has taken for itself; every other path is linked and follows the project's style.

Link granularity, version one: `base`, `masses`, `texture`, `modes`, and each `depth.<layer>`. `photo`, `seed`, `loop`, `states`, `canvas` and `captionMask` always belong to the background. An edit to a linked path in a background marks it overridden; "Relink" drops the override and takes the project's value again. An edit to a project's style flows into every background where that path is linked.

Migration: each of the nine presets becomes a project of the same id whose style is that card's current values, with the card as its one background and `primary`, and no overrides, so nothing changes on screen. A background file with no `project` gets one synthesized the same way, with a warning.

**Spread and House pull, as the shuffle reads them** (job 2):
- A background's shuffle starts from its **project's style**, not from its own current values, and `spread` takes the place the family's `variety` had. At spread 0 a shuffle returns the style (a new seed, so only the grain changes); at 1 every rolled number may go anywhere its range allows. Hue jitter scales with spread up to a free hue at 1. Each of the three modes (colour, coverage, structure) is re-rolled with probability `spread` and otherwise kept from the style.
- The ranges the shuffle rolls within are the family's ranges widened by `1 − housePull` toward the legal limits (L 0.12–0.97, chroma up to the gamut cap, one to four masses, every depth layer allowed, sizes and softness to their validator limits). At House pull 1 the family's ranges and `allowed` flags bind as today; at 0 a project may use anything the shader can draw, including the layers no card uses yet (swirl, ridges, strokes, shadow, finish blurs).
- Locked items and hand-edited (dirty) values are still never rolled. A stage the shuffle changes becomes an override, as any edit does.
- **New background** adds a card to a project with id `<project>-<n>` (first free n), a new seed, and the result of one shuffle from the style at the project's spread. It is not the primary.
- **Shuffle project** re-rolls the project's style itself, from the family's defaults, within the house-widened ranges, at variety `1 − housePull`; its linked backgrounds follow.
- The family's `variety` is retired from the panel; the field stays in the file, unused, so no migration is needed.

**Browse and the panel, grouped** (job 3):
- Browse shows the library grouped by project, in the order of each project's first card. Each group has a header: the project's name, its background count, its Spread, and two actions, **New background** and **Shuffle project**. Its backgrounds follow, primary first, carrying a small **Primary** tag. Grid wraps a group's cards; Rail gives each project its own horizontal rail under its header. Focus is unchanged: a card flies out of its group and back.
- A card whose background has taken stages for itself shows how many ("2 own") beside the existing "modified" badge. A linked card shows nothing extra.
- The panel has two scopes, picked at its top: **Background** (today's panel, for the focused card) and **Project** (that card's project). In Project scope the same folders edit the project's style, and every linked background updates live. In Background scope each linkable folder says whether it follows the project: its title reads plainly when linked and gains "· own" when overridden, with a **Relink** button inside that drops the override. Background scope also has **Make primary**.
- Spread and House pull stay at the top in both scopes.

**Siblings follow their project** (job 3b, replacing job 1's "any change is an override" for generated backgrounds): a background carries `variation`, a seed or `null`. With `null` its linked stages equal the project's style (the nine migrated cards and every primary until shuffled). With a seed, its linked stages are **derived**: one shuffle of the style at that seed and the project's Spread, within the house ranges, so the result is fixed by (style, Spread, House pull, seed). New background and Shuffle give a background a new seed and mark nothing "own"; only a hand edit on the panel, a lock, or a forced mode makes a stage own. A style edit, a Spread change or a House pull change re-derives every linked background live, each keeping its own seed, so Spread is a push-and-pull dial on the whole group. The file stores the seed and the derived values; on load the linked stages are derived again and must match, so an untouched card never shows "modified".

**Motion per project and per mass** (job 4). Motion was one family setting (every mass on a 0.1-width circle, twice per 12 s loop), so all nine cards moved alike. It becomes a linkable stage and a property of each mass:
- **Card motion** (`motion`, a new LinkPath, so a project sets it and its backgrounds follow): `travel` (0..1, how far masses move; 0.6 reproduces today's drift radius), `tempo` (revolutions per loop, integer 1–4; 2 is today's), and `loop.seconds` offered on the panel from 8 to 24. The family's `motion` block becomes the house default and range.
- **Mass motion** (`masses[i].motion`): `path` (`circle`, `ellipse`, `line`, `figure8`; circle is today's), `travel` (×0..2 on the card's travel), `angle` (degrees, orients ellipse, line and figure-eight), `pulse` (0..0.3, the size swells and shrinks by that fraction), and `shift` (0..40 degrees, the hue sways that far either side). Every term runs at an integer number of cycles per loop, so the loop stays seamless; `line` eases at its ends so it reads as a sway, not a bounce.
- Defaults reproduce today exactly: travel 0.6, tempo 2, every mass a circle at travel 1, angle 0, pulse 0, shift 0. The shuffle rolls mass motion within house ranges scaled by Spread, like any other stage.
- Ridges move as a whole curve (as now); pulse widens and narrows the crest; shift moves its ramp's hues together.

Built in order (BACKLOG.md): the schema; Spread and House pull in the shuffle with New background; Browse grouped by project with a project panel and linked/overridden marks; motion per project and per mass (shader); handoff and ship for several backgrounds per project. New shape kinds (bands, lines, edges, flow fields) come after, as their own job.

### Photo stage (Joe, 2026-11-03: "drop in photos and process them with the shader toolkit; the result should be something in between the photo and what we have built here")

This supersedes the earlier "character only" image grammar. A photo is now a first-class input and the picture may stay visible. The card is a point on a continuum from the photograph to the abstract field, set by one dial, **fidelity** 0..1:

- The photo is loaded as a texture (cover-fit to the card) and a blur pyramid of it. Fidelity picks the blur level and the mix: low fidelity is the heavily blurred photo as colour and light placement only, with the toolkit's masses on top; high fidelity keeps edges and texture and the toolkit works *on* the photo rather than replacing it.
- The photo's luminance feeds the **height field**, so Light shades its forms and the pleats, strokes and curve respond to them.
- On drop, masses are **extracted** from the photo (dominant clusters, placed at their centroids) as editable starting points, so every other dial keeps working.
- **Strokes** follow the photo's edges (perpendicular to its luminance gradient) when follow is on, so the marks paint the picture.
- Grain, Finish blurs, Haze and motion apply as before. On the loop the photo itself does not swim: what moves is the light, the masses laid over it, the strokes, and a slow drift of the blur; see the Critic's grammar below.
- Storage: the dropped file is downscaled to card export size (1226×816) and saved beside the preset as `presets/photos/<id>.webp` (small, tracked); the preset references it by path. In the hosted build it lives in IndexedDB and downloads with the preset. Full-resolution masters never enter the repo.

**The continuum (Critic).** The two ends of the useful range are the Pioneer dusk (a horizon reduced to three bands under grain, UI on the calm band) and the daisies (white masses with yellow cores on blue, blurred past any petal).

| Fidelity | Name | Survives | Toolkit adds |
|---|---|---|---|
| 0.2 | weather | palette, where the light sits; two or three extracted masses | everything else: Light on the masses, grain, drift. A stranger could not name the subject |
| 0.5 (default) | Pioneer | large forms as a blurred field (σ ≈ W/16), Light shades those forms | extracted masses at half strength, strokes along the dominant edge at low amount, grain full. A horizon or a field of flowers, no petal |
| 0.8 | daisies | forms and soft edges (σ ≈ W/40), no texture | masses off or a quarter strength as colour correction, Light at half, strokes off, grain full. A photo through frosted glass |

**Mechanism** (retuned after the first daisies render, where white covered most of the frame and every area-weighted step landed near white). Four-level blur pyramid (σ = W/10, W/22, W/50, W/80), built once per photo, blurred in OKLab (not linear light, or highlights swallow everything), each level auto-levelled back to the original's P5–P95 lightness range (global, so no halo) and its chroma restored ×1.3 under the family cap (blur averages chroma toward grey). Extraction at W/22: k-means k=5 in OKLab, keep three scored by area × (0.3 + 4·C) so a small saturated cluster beats a big white one, chroma ×1.4 clamped to 0.18, L clamped 0.2–0.9; the largest, darkest cluster becomes the base, so the base comes from the photo at any fidelity above 0. Shader order: sample the pyramid at the level fidelity selects, blending adjacent levels (0.2 → W/10, 0.5 → W/22, 0.8 → W/50); base mix 0.25 / 0.6 / 0.9; masses at weight 1.0 / 0.6 / 0.25; height from the photo's luminance 0.3 / 1.0 / 0.7 so Light shades the photo's own forms even at 0.2; light scale 1.0 / 1.0 / 0.6; strokes' direction field is perpendicular to the photo's luminance gradient, so marks paint along ridges and horizons; haze, swirl, blurs and grain unchanged.

**Never.** No detail from levels finer than W/40. No local contrast or unsharp mask (the HDR halo). No vignette, no colour LUT, no warm/cool shift on the photo itself: colour changes come from masses, not grading (the filter trap). Swirl above 0.1 makes a still photo swim.

**What moves.** Not the photo. Masses drift on their circles, Light's direction breathes by 2°, strokes' presence slides. The sky is still; the light on it is alive.

**Cohesion.** Same pyramid levels and σ per fidelity point, same Light, grain and drift, and the extracted palette passes through the family chroma cap and tonal rules. Six photos become six subjects shot on one film stock under one lamp.

### State grammar (Critic, restated for lights)

The host morphs; the background answers. A state may move **light value and chroma only**: never positions (the lights jump), never size, never hue (a colour change is a different card), never loop phase.

- **Hover:** light comes up. Every light's value +0.08, nothing else. 0.3s ease-out in, 0.45s out.
- **Active:** brighter and a little flatter so the card becomes a surface for copy. Value +0.15, chroma ×0.9, optionally speed ×0.5. 0.6s inOut in, 0.9s out.
- Reduced motion: states snap.

Rules: `shader` carries a version so a change never silently reinterprets old files; base value at or above L 0.18 and the brightest light at or above L 0.75; `image` is a path under `public/`, never a data URL; pretty-printed, sorted keys.

Image extraction under this model: k-means in OKLCH on the image; the darkest large cluster becomes the base, the two brightest become lights, placed at the centroids of their regions (mapped into the family's position bounds), with chroma clamped to the family max.

### Family defaults (Critic)

Base L 0.25–0.88, base C ≤ 0.08. Masses 2–3 (cap 4), chroma ≤ 0.18, size 0.55–1.1 card widths, softness 0.4–0.7 (default 0.6). Grain 0.06 (range 0.04–0.08), luminance-scaled, static. Drift radius 0.03 widths (0.02–0.05). Loop 24s. On by default: Curve 0.3 (0.15–0.45), Haze 0.25 (0.1–0.4), Parallax 0.5. Off by default, at most one per card: Swirl 0.15–0.3, Relief 0.15 (0.1–0.25) at frequency 85. Shadow is preview-only.

Value corrections after the first render (OKLCH L): wildflower shadow 0.30, poppy 0.68; human-in-the-loop base 0.26, window 0.80, leather 0.38; dash pink 0.84, plum 0.24; dropbox-meetings crimson 0.50, navy 0.28; paper base 0.22, sky 0.76; showreel dark blob 0.22, aperol 0.74. One mass per card is pushed to an extreme so every card clears the 0.35 L range.

### Starting palettes (Critic, carousel order; OKLCH h/L/C, positions in card units, size in widths, softness)

| Project | Base | Masses | Depth |
|---|---|---|---|
| wildflower | 85/0.82/0.05 sunlit cream | poppy 50/0.62/0.17 @ (0.75, 0.85) 0.9/0.8; magenta 340/0.60/0.12 @ (0.10, 0.55) 0.7/0.85; warm shadow 85/0.45/0.04 @ (1.20, 0.10) 0.8/0.9 | Curve, Haze, Parallax |
| human-in-the-loop | 60/0.30/0.03 dark umber | window amber 70/0.72/0.13 @ (1.05, 0.20) 0.8/0.75; leather 50/0.45/0.09 @ (0.30, 0.80) 1.0/0.9 | Curve, Haze, Parallax |
| dash | 315/0.60/0.05 mauve | pink 350/0.78/0.10 @ (0.35, 0.25) 0.7/0.8; plum shadow 300/0.32/0.06 @ (1.15, 0.80) 0.9/0.85 | Curve, Haze, Relief 0.3 |
| dropbox-meetings | 20/0.86/0.02 grey | crimson 15/0.55/0.19 @ (0.50, −0.10) 1.0/0.8; navy shadow 260/0.35/0.07 @ (1.30, 0.90) 0.7/0.9 | Curve, Haze, Parallax |
| paper | 262/0.25/0.06 navy | sky 245/0.68/0.13 @ (1.10, 0.95) 1.1/0.7; peach 55/0.72/0.08 @ (0.20, 0.15) 0.6/0.9 | Curve, Haze, Parallax |
| showreel | 60/0.78/0.01 Polar grey | dark blob 60/0.30/0.01 @ (0.60, 0.50) 0.8/0.75; aperol 45/0.70/0.12 @ (1.20, 0.85) 0.6/0.85 | Curve, Haze, Relief 0.35 |

Three light bases, two dark, one mid; two monochrome, four two-hue; every card has one dark or low-chroma mass so the set is never six glows.

## 5. Reuse map (Builder)

| From | What | How |
|---|---|---|
| `Bitmania/index.html` | WebGL2 compile/link helpers, `#version 300 es` fragment pattern, image and video texture upload with aspect correction, PNG export | Lift the GLSL and texture logic; rewrite plumbing as a hook |
| `Portfolio/src/ui/Carousel` | The real card slot contract: `renderItem` fills a 613×408 `carousel-item__surface` | Target, not dependency. Export matches its size |
| `Portfolio/src/components` `useCardGlow` | Accepts any `CanvasImageSource`; a canvas plugs in directly | For the live-in-carousel phase |
| `Portfolio/src/design-system/tokens/*.css` | Greys, accents, spacers, corners | Copy the CSS, skip `fonts.css` (licensed) |
| `Portfolio/src/useGridTier.ts` | Breakpoint tiers | Copy |
| `Portfolio/src/transitions.tsx` lines 5–23 | Storyboard comment block idiom | Copy the idiom |
| `~/.claude/skills/interface-craft/dialkit*.md` | Controls: slider, color, image, pad, select, presets, timeline transport | Use as built |
| `ui-kit` Carousel | Behind Portfolio's vendored copy, DialKit 1.4 peer | Not used |
| `TraceVisualizer` | 2D canvas only | Not used, except its offscreen `toBlob` thumbnail idiom |

## 6. Workflow states

The app is a small state machine. Each state has its own layout, its own DialKit panel, and its own entry and exit transitions.

```
Browse (Grid | Rail) ──select──▶ Focus ──▶ [Export sheet] ──done──▶ Focus
  ▲                                │ ▲
  └──────────escape────────────────┘ └──compose (later)──▶ Compose ──▶ Focus
```

- **Browse / Grid.** A library, not six project slots (Joe, 2026-10-29: backgrounds are imported per card, so no preset corresponds to a project by default). Any number of cards, each with its own name; New, Rename, Duplicate, Delete, Export per card. Thumbnails cached, hover plays the live loop one cell at a time through the shared context. The six original cards are the starting library.
- **Browse / Rail.** Every card at card scale, in file order, on #fafafa with an approximate aura. Family dials edit live from here. **This is where cohesion is judged**, not in the grid and not in the tool chrome.
- **Focus.** One preset takes the screen (layoutId), rendering at full DPR. Four free dials plus the ramp editor and transport (play, pause, loop, scrub). Escape returns it to its cell.
- **Export sheet** (over Focus, not a state of its own). Choose poster frame (`stillTime`), loop length, formats. Writes preset JSON, PNG, WebM, named `card-<project>` into `out/`, with a one-line copy command for Portfolio. Done returns to Focus with the card untouched.
- **Compose** (deferred). Layers over a finished shader: images, text, code snippets, each with its own Storyboard clip on a DialKit timeline. This is a motion-design app; it ships after six cards have sat on the page.

### Portable behaviour

The card's own sequence (idle → hover → active → back) is defined in the preset's `states` block and previewed in Focus with a state switcher on the transport. ShaderLab never changes the host. The host only tells the card which state it is in: for path A by choosing which clip to play, for path B by setting the `state` prop. The Portfolio's existing morph keeps owning the card-to-page flight; the shader just answers it.

## 7. Phases

Status now lives in `BACKLOG.md`. What follows is the original day-one plan, kept for its reasoning.

**Day one (today).**
1. Repo scaffold, tokens, launch config, DialKit pinned.
2. `useShaderCanvas` hook with one `flow-field@1` shader: FBM field, grain, vignette, caption mask, ramp-over-field, circular periodic time.
3. DialKit panel: four free dials, ramp editor (3 to 5 color stops), family dials in a collapsed folder, transport.
4. Browse grid and Rail with shared offscreen renderer, Focus with layoutId expand and Escape return, Export as a sheet.
5. Export PNG + preset JSON. WebM if WebCodecs cooperates in the first hour, otherwise tomorrow.
6. Six presets, one per Portfolio project, dropped into Portfolio and reviewed on the page.

**Week one.** Image model in full (extraction, structure, fidelity dial). `states` block with the state switcher in Focus and one clip per state on export. WebM export hardened. `ShaderCard` package (path B) with measured numbers, behind a flag in Portfolio with video fallback. Second shader variant in the same family.

**Later.** Compose mode. Editor timeline. GIF.

## 8. Roles and rhythm

- **Planner** holds this spec, sequences the work, and is the only agent that talks to Joe. Every Builder hand-off is one phase step with a definition of done.
- **Critic** gives a verdict on finished renders against section 2: does it match, and what looks off, in words. It does not set formulas, constants or mechanisms; those come from a Builder measuring real pixels. The Critic sees screenshots, not data, and its guessed photo-extraction score is what washed out the daisies (2026-11-04). Called only when Joe wants a second eye on a new look; a before/after Joe can judge himself does not need one.
- **Builder** executes one job, reuses the map in section 5, and reports performance numbers (fps at six thumbnails plus one focused card, on this Mac) with every rendering change.

Each Builder and Critic is a fresh agent per job, never one resumed across jobs, and small fixes are done inline with no agent. The full cost rules are in CLAUDE.md, "Working cheaply".

A Critic verdict, or Joe's own, gates the day-one cut: a card that looks right in ShaderLab but makes the page's aura muddy is not done.

## 9. Performance: the two runtime paths

**Path A, exported video.** Six 613×408 loops decode in hardware; this is exactly what the carousel does today, so the added cost is zero. Downsides: file size (roughly 1 to 3 MB per 24s clip per state at good quality), no response to state beyond clip switching, and a re-export whenever a preset changes.

**Path B, live.** Cost scales with pixels × octaves × frames. One 613×408 card at DPR 2 is about one million fragments per frame; six cards at 60 fps is 360 million fragment evaluations a second, each running four octaves of noise plus a texture sample. An M-series GPU does that without strain. The costs that actually bite are elsewhere:

- **Context count.** Six live contexts is under the browser cap, but one shared context blitting to six 2D canvases is cheaper and survives tab switching better.
- **Battery and thermals.** A continuously animating GPU keeps the machine warm. Mitigations the Builder must ship with path B: cap at 30 fps, render cards at DPR 1 and the focused card at DPR 2, pause cards outside the viewport through IntersectionObserver, and freeze on `prefers-reduced-motion`.
- **The aura.** Portfolio's glow samples the card at 12×4 through a 2D canvas `drawImage`; never `readPixels`. At the existing 60 ms cadence it is negligible.
- **Phones.** Fragment cost at phone DPR 3 with six cards is the real risk. Path B defaults off on touch devices and falls back to path A until measured.

The Builder records, with every rendering change: fps and GPU time for six thumbnails plus one focused card on this Mac, in Chrome and Safari, with and without the mitigations above. Those numbers, not estimates, decide whether path B goes live anywhere.
