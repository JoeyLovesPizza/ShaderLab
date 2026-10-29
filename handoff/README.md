# Shader backgrounds for Portfolio carousel cards

Read this if you are placing a ShaderLab background on a carousel card in
`~/Projects/Portfolio`. Everything you need is in this folder and in the
assets that `npm run ship` (run from `~/Projects/ShaderLab`) copies into
Portfolio.

## What a background is

A background is one image asset for a card's **art layer**. It is not a card.
It sits under the card's UI artwork inside the art box (`.card-art` in
Portfolio), and the card's **mask layer** (the rounded surface in the vendored
Carousel) clips and transforms it like any other art asset. Stack it with
other art assets for parallax; it does not care what sits on top of it.

The UI artwork on top must have a transparent surround for the background to
show. Opaque exports hide it completely.

## Files

| Path (after `npm run ship`) | What |
|---|---|
| `Portfolio/public/work/shaders/card-<id>.webp` | The background image, 1226×816, about 160–200 KB. `<id>` is the project id from `src/data/projects.ts`. |
| `Portfolio/public/shaders/<id>.json` | The ShaderLab preset the image was rendered from. Not needed at runtime; keep it so the card can be re-rendered or animated later. |
| `Portfolio/public/shaders/backgrounds.json` | Manifest: every background, its file, its project, and the average colour to use as the card's `shadowColor`. |
| `ShaderLab/handoff/ShaderBackground.tsx` | A component that renders one background into the art layer. Copy it into `Portfolio/src/components/`. |
| `ShaderLab/handoff/shader-background.css` | Its three CSS rules. Append to `Portfolio/src/App.css` next to `.case-study-image`. |

## Placing one on a card

Inside whatever renders the card's art (the function passed to the Carousel's
`renderItem`, or a per-card art component such as `WildflowerCardArt`), put the
background first, then the artwork:

```tsx
import { ShaderBackground } from '../components/ShaderBackground'

<ShaderBackground id="wildflower" />
<CaseStudyImage src="/work/wildflower/ui.png" alt="Wildflower" />
```

The component renders:

```html
<img class="shader-background" src="/work/shaders/card-wildflower.webp" alt="" aria-hidden="true">
```

positioned absolutely to fill the art box, so the art box needs
`position: relative` (the CSS file sets it on `.card-art`). Siblings after it
paint on top in DOM order. For parallax, transform the background and the
artwork by different amounts; the component takes a `style` prop for that.

## Lighting the card glow from the background

Portfolio's `useCardGlow` samples whatever `CanvasImageSource` it is handed. To
light the glow from the background instead of the UI (recommended: the
background carries the card's colour), pass `glow` to the component and it
will call `useCardGlow` with its own image once loaded:

```tsx
<ShaderBackground id="wildflower" glow />
```

Then do not also paint the glow from the artwork on top, or the two fight.

## `shadowColor`

Use the `shadowColor` from `backgrounds.json` for the project's `shadowColor`
in `src/data/projects.ts`. It is the average colour of the rendered
background, which is how the existing values were made.

## Ids

| id | project |
|---|---|
| `wildflower` | Wildflower |
| `human-in-the-loop` | Human In the Loop |
| `dash` | Dash |
| `dropbox-meetings` | Dropbox meetings |
| `paper` | Paper |
| `showreel` | Showreel |

## Regenerating

Tune in ShaderLab (`npm run dev`, port 5176), save the card to file, press
Export all, then `npm run ship`. The WebPs, presets and manifest in Portfolio
are overwritten; nothing under `Portfolio/src` is touched.
