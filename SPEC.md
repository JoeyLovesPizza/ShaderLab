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
4. **Depth.** A stack of independent layers, each with on/off and an amount, in a fixed compositing order. Curve, Parallax and Haze combine freely; of the structure layers (Swirl, Relief) at most one is on per card, because no reference stacks two. A Grid layer (perspective wireframe, as on the middle ElevenLabs tile) was built and then cut by Joe on 2026-10-28:
   - **Curve.** The base is a slightly bent surface; falloff follows it, so a mass reads as sitting on a sheet rather than floating.
   - **Parallax.** Each mass gets a distance; nearer masses drift more over the loop, farther less. Nothing moves at amount 0.
   - **Haze.** Value fades toward the base with distance from the nearest light mass, deepening the far side.
   - **Swirl.** A slow domain warp that drags the masses into marbled flow (the pink-yellow swirl reference). Amount is warp strength; it loops with the motion.
   - **Relief.** Fine pleats lit by the light masses (Polar), as a normal-mapped surface, visible where lit. Frequency and twist as its own params.
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

### Image grammar (week one)

Character only, confirmed by Joe. Under the lights model an image contributes colours and light placement, never pixels: the darkest large cluster becomes the base, the two brightest become lights at the centroids of their regions, mapped into the family's position bounds. Fidelity 0..0.6 sets how far the extracted positions and chroma may depart from the family defaults; above 0.6 is a detent for one deliberate card. A visible picture is compose mode.

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

- **Browse / Grid.** Grid of presets, thumbnails cached, hover plays the live loop one cell at a time through the shared context. "New from family" and "New from image".
- **Browse / Rail.** The six presets at card scale, in carousel order, on #fafafa with an approximate aura. Family dials edit live from here. **This is where cohesion is judged**, not in the grid and not in the tool chrome.
- **Focus.** One preset takes the screen (layoutId), rendering at full DPR. Four free dials plus the ramp editor and transport (play, pause, loop, scrub). Escape returns it to its cell.
- **Export sheet** (over Focus, not a state of its own). Choose poster frame (`stillTime`), loop length, formats. Writes preset JSON, PNG, WebM, named `card-<project>` into `out/`, with a one-line copy command for Portfolio. Done returns to Focus with the card untouched.
- **Compose** (deferred). Layers over a finished shader: images, text, code snippets, each with its own Storyboard clip on a DialKit timeline. This is a motion-design app; it ships after six cards have sat on the page.

### Portable behaviour

The card's own sequence (idle → hover → active → back) is defined in the preset's `states` block and previewed in Focus with a state switcher on the transport. ShaderLab never changes the host. The host only tells the card which state it is in: for path A by choosing which clip to play, for path B by setting the `state` prop. The Portfolio's existing morph keeps owning the card-to-page flight; the shader just answers it.

## 7. Phases

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
- **Critic** reviews each step's output against section 2 before it is called done, and reviews every new preset on the Portfolio page, not in the tool.
- **Builder** executes steps, reuses the map in section 5, and reports performance numbers (fps at six thumbnails plus one focused card, on this Mac) with every rendering change.

Critic's verdict gates the day-one cut: a card that looks right in ShaderLab but makes the page's aura muddy is not done.

## 9. Performance: the two runtime paths

**Path A, exported video.** Six 613×408 loops decode in hardware; this is exactly what the carousel does today, so the added cost is zero. Downsides: file size (roughly 1 to 3 MB per 24s clip per state at good quality), no response to state beyond clip switching, and a re-export whenever a preset changes.

**Path B, live.** Cost scales with pixels × octaves × frames. One 613×408 card at DPR 2 is about one million fragments per frame; six cards at 60 fps is 360 million fragment evaluations a second, each running four octaves of noise plus a texture sample. An M-series GPU does that without strain. The costs that actually bite are elsewhere:

- **Context count.** Six live contexts is under the browser cap, but one shared context blitting to six 2D canvases is cheaper and survives tab switching better.
- **Battery and thermals.** A continuously animating GPU keeps the machine warm. Mitigations the Builder must ship with path B: cap at 30 fps, render cards at DPR 1 and the focused card at DPR 2, pause cards outside the viewport through IntersectionObserver, and freeze on `prefers-reduced-motion`.
- **The aura.** Portfolio's glow samples the card at 12×4 through a 2D canvas `drawImage`; never `readPixels`. At the existing 60 ms cadence it is negligible.
- **Phones.** Fragment cost at phone DPR 3 with six cards is the real risk. Path B defaults off on touch devices and falls back to path A until measured.

The Builder records, with every rendering change: fps and GPU time for six thumbnails plus one focused card on this Mac, in Chrome and Safari, with and without the mitigations above. Those numbers, not estimates, decide whether path B goes live anywhere.
