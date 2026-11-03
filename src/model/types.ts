/*
 * The preset schema, version 2, fourth pass (SPEC.md §2 and §4): a card is
 * items with a hue and a value, in five stages (base, masses, texture,
 * depth, motion), plus a seed and the three choices the shuffle rolled
 * from it. validate.ts enforces the rules; pack.ts turns one of these into
 * uniforms for `masses@1`.
 *
 * Hue is OKLCH degrees, value is OKLCH L, chroma is OKLCH C. Positions are
 * card units: x 0..1.5, y 0..1 (y up) for 613 × 408, and masses may sit
 * outside the card.
 */

export interface BaseColor {
  hue: number
  value: number
  chroma: number
  /** Shuffle leaves a locked item alone. */
  locked: boolean
}

export interface MassColour {
  hue: number
  value: number
  chroma: number
}

export interface Point {
  x: number
  y: number
}

/**
 * A soft mass of colour or shadow, lighter or darker than the base. A
 * `blob` falls off from `x, y`; a `ridge` falls off from a cubic Bézier
 * (`path.start`, `control1`, `control2`, `end`), so its crest can
 * inflect into an S, coloured by a three-stop ramp along it (`ramp.start`,
 * the mass's own colour in the middle, `ramp.end`). A ridge's `x, y` only
 * anchors its drift. Either feeds the
 * height field by its falloff, so a ridge's crest lifts and the light
 * shades its upper edge and underside.
 */
export interface Mass extends MassColour {
  kind: 'blob' | 'ridge'
  x: number
  y: number
  /** Falloff radius (a ridge's half width), card widths. */
  size: number
  /** 0.4 is a firm block, 0.9 a long gentle tail. */
  softness: number
  /** 0 near, 1 far: nearer masses drift more under Parallax. */
  distance: number
  locked: boolean
  /** Ridge only: the curve, card units. */
  path: { start: Point; control1: Point; control2: Point; end: Point }
  /** Ridge only: the colours at t 0 and t 1, and how far the ramp also
      fills the field across the start→end chord (0: the crest alone). */
  ramp: { start: MassColour; end: MassColour; fieldMix: number }
}

export const MASS_KINDS = ['blob', 'ridge'] as const

/** A blob from its own fields, with the ridge fields parked around it. */
export function blobMass(m: Omit<Mass, 'kind' | 'path' | 'ramp'>): Mass {
  const colour = { hue: m.hue, value: m.value, chroma: m.chroma }
  return {
    ...m,
    kind: 'blob',
    path: { start: { x: m.x - 0.4, y: m.y - 0.2 }, control1: { x: m.x, y: m.y }, control2: { x: m.x, y: m.y }, end: { x: m.x + 0.4, y: m.y + 0.2 } },
    ramp: { start: { ...colour }, end: { ...colour }, fieldMix: 0 },
  }
}

/**
 * A mass as the shader and the panel need it, whatever shape it arrived
 * in: a mass from an overlay written before kinds, paths or ramps existed
 * gets the blob defaults for what it lacks. Belt and braces under the
 * validator, which migrates every overlay on load.
 */
export function withMassShape(m: Partial<Mass> & Omit<Mass, 'kind' | 'path' | 'ramp'>): Mass {
  const blob = blobMass(m)
  const path = m.path ?? blob.path
  const ramp = m.ramp ?? blob.ramp
  return {
    ...blob,
    kind: m.kind === 'ridge' ? 'ridge' : 'blob',
    path: {
      start: path.start ?? blob.path.start,
      control1: path.control1 ?? (path as Partial<Mass['path']>).control2 ?? { x: m.x, y: m.y },
      control2: path.control2 ?? (path as Partial<Mass['path']>).control1 ?? { x: m.x, y: m.y },
      end: path.end ?? blob.path.end,
    },
    ramp: { start: ramp.start ?? blob.ramp.start, end: ramp.end ?? blob.ramp.end, fieldMix: ramp.fieldMix ?? 0 },
  }
}

export interface DepthLayer {
  on: boolean
  amount: number
}

/**
 * Light (SPEC.md §2): the masses, Curve, Relief and Strokes make a height
 * field, and one directional light from the family shades its normal.
 * `height` scales the field; at 0 the card is flat and looks as it did
 * without the layer.
 */
export interface LightLayer {
  on: boolean
  height: number
}

/**
 * Strokes (SPEC.md §2, "painted grass"): fibres along one direction, as
 * ±lightness and as low ridges in the height field. `direction` is
 * degrees, ignored while `followAngle` takes the family's; `length` is
 * card widths; `density` is fibres across the card's height.
 */
export interface StrokesLayer extends DepthLayer {
  direction: number
  followAngle: boolean
  length: number
  density: number
  /** How much the fibres drift, sway and breathe over the loop, 0..1;
      scaled by the family's Motion dial. */
  motion: number
}

/** The depth stack, in compositing order. */
export interface Depth {
  light: LightLayer
  curve: DepthLayer
  parallax: DepthLayer
  haze: DepthLayer
  /** `scale` is the warp's wavelength in card widths (0.6 is the marbling; 1.2 one slow fold). */
  swirl: DepthLayer & { scale: number }
  relief: DepthLayer & { frequency: number; twist: number }
  strokes: StrokesLayer
  shadow: DepthLayer & { rect: [number, number, number, number]; offset: number; spread: number }
}

export type DepthLayerName = keyof Depth
export const DEPTH_ORDER: DepthLayerName[] = ['light', 'curve', 'parallax', 'haze', 'swirl', 'relief', 'strokes', 'shadow']
/** Of these, at most one may be on per card. */
export const STRUCTURE_LAYERS = ['swirl', 'relief', 'strokes'] as const
export type StructureLayer = (typeof STRUCTURE_LAYERS)[number]

/** The three choices the shuffle rolls before it rolls numbers (SPEC.md §2). */
export const COLOUR_MODES = ['mono', 'warm-cool', 'triad', 'free'] as const
export const COVERAGE_MODES = ['blend', 'block', 'flat'] as const
export const STRUCTURE_MODES = ['none', 'swirl', 'relief', 'strokes'] as const
export type ColourMode = (typeof COLOUR_MODES)[number]
export type CoverageMode = (typeof COVERAGE_MODES)[number]
export type StructureMode = (typeof STRUCTURE_MODES)[number]

export interface Modes {
  colour: ColourMode
  /** One mass may carry chroma up to the bold cap. */
  bold: boolean
  coverage: CoverageMode
  structure: StructureMode
}

/** The Finish stage (SPEC.md §2): two blurs as post-process passes. */
export interface Finish {
  motionBlur: {
    on: boolean
    /** Degrees; ignored when `followAngle` takes the family's angle. */
    angle: number
    followAngle: boolean
    /** Card widths, 0..0.3. */
    length: number
    /** Mix with the unblurred field, 0..1. */
    intensity: number
  }
  layerBlur: {
    on: boolean
    /** Card widths, 0..0.15. */
    radius: number
    intensity: number
  }
}

export interface PresetCanvas {
  width: number
  height: number
  dpr: number
}

export interface PresetLoop {
  seconds: number
  fps: number
  stillTime: number
}

export interface PresetImage {
  src: string
  fidelity: number
  rampSource: 'extracted' | 'edited'
}

export interface StateTransition {
  duration: number
  ease: 'out' | 'inOut' | 'in' | 'linear'
  durationOut?: number
}

/** A state moves mass value and chroma only: `u_exposure` is added to
    every mass's value, `u_contrast` multiplies every mass's chroma. */
export interface PresetState {
  uniforms: { u_exposure?: number; u_contrast?: number }
  loop?: boolean
  transition?: StateTransition
}

export type StateName = 'idle' | 'hover' | 'active'

export interface PresetMeta {
  name: string
  project?: string
  created: string
}

export interface Preset {
  schema: 2
  id: string
  shader: `${string}@${number}`
  canvas: PresetCanvas
  loop: PresetLoop
  /** The shuffle's seed; a file reproduces exactly from it. */
  seed: number
  /** What the shuffle chose, kept so Joe can override any one without re-rolling. */
  modes: Modes
  base: BaseColor
  /** One to four. */
  masses: Mass[]
  texture: { grain: number }
  depth: Depth
  finish: Finish
  captionMask: boolean
  image: PresetImage | null
  states?: Partial<Record<StateName, PresetState>>
  meta: PresetMeta
}

/** The part of a preset the panel and the shuffle edit. */
export type CardDraft = Pick<
  Preset,
  'seed' | 'modes' | 'base' | 'masses' | 'texture' | 'depth' | 'finish' | 'captionMask' | 'loop'
>

export type Range = [number, number]

export interface FamilyLayer {
  /** Default state for a new card. */
  on: boolean
  /** Whether the shuffle may switch this layer on. */
  allowed: boolean
  amount: Range
}

/**
 * The family: what every card shares and the bounds the shuffle respects
 * (SPEC.md §2 and §4, Family defaults). Stored in presets/family.json.
 */
export interface Family {
  schema: 2
  shader: Preset['shader']
  /** How far the shuffle ranges from the family defaults, 0..1. */
  variety: number
  base: { value: Range; chromaMax: number }
  masses: {
    /** How many masses a card may carry, inclusive. */
    count: Range
    size: Range
    softness: Range
    x: Range
    y: Range
    chromaMax: number
    /** The bold flag may raise one mass's chroma to this. */
    boldMax: number
    boldAllowed: boolean
  }
  texture: {
    grain: number
    range: Range
    /** Static grain hashes on the seed; animated grain on every other frame. */
    animate: boolean
  }
  motion: {
    /** Radius of each mass's drift circle, card widths, at Motion 0.6. */
    driftRadius: number
    driftRange: Range
    /** Revolutions per loop, an integer, so the loop stays seamless. The
        Motion dial overrides it: 1 below 0.45, 2 to 0.85, 3 above. */
    speed: number
    /** The one knob, 0..1 (default 0.6): scales the drift radius and
        picks the revolutions per loop together. */
    amount: number
    /** The family's direction in degrees: the pleats run along it, and a
        motion blur that follows the family blurs along it. */
    angle: number
  }
  finish: {
    motionBlur: { allowed: boolean; length: Range; intensity: Range }
    layerBlur: { allowed: boolean; radius: Range; intensity: Range }
  }
  captionZone: number
  /** The one light every card is shaded by (SPEC.md §2, Light). */
  light: {
    /** Degrees; ignored while `followAngle` takes the family's direction. */
    angle: number
    followAngle: boolean
    /** Degrees above the surface. */
    elevation: number
    /** How far the shade moves lightness, 0.1–0.3. */
    amount: number
  }
  depth: {
    /** `amount` is the height range for a new card. */
    light: FamilyLayer
    curve: FamilyLayer
    parallax: FamilyLayer
    haze: FamilyLayer
    swirl: FamilyLayer & { scale: number }
    relief: FamilyLayer & { frequency: number; twist: number }
    strokes: FamilyLayer & { length: number; density: number }
    shadow: FamilyLayer
  }
  /** `version` rises when the family's defaults change in a way that makes
      an older session's overlays stale; the card store clears them once. */
  meta: { name: string; created: string; version?: number }
}

/** Tonal rules (SPEC.md §2): nothing below or above these in OKLCH L. */
export const L_MIN = 0.12
export const L_MAX = 0.97
/** Every card needs at least this much L range between its darkest and lightest region. */
export const L_RANGE_MIN = 0.35
export const MAX_MASSES = 4
