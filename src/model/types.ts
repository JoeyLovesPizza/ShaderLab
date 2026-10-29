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

/** A soft mass of colour or shadow. Lighter or darker than the base. */
export interface Mass {
  hue: number
  value: number
  chroma: number
  x: number
  y: number
  /** Falloff radius, card widths. */
  size: number
  /** 0.4 is a firm block, 0.9 a long gentle tail. */
  softness: number
  /** 0 near, 1 far: nearer masses drift more under Parallax. */
  distance: number
  locked: boolean
}

export interface DepthLayer {
  on: boolean
  amount: number
}

/** The depth stack, in compositing order. */
export interface Depth {
  curve: DepthLayer
  parallax: DepthLayer
  haze: DepthLayer
  swirl: DepthLayer
  relief: DepthLayer & { frequency: number; twist: number }
  shadow: DepthLayer & { rect: [number, number, number, number]; offset: number; spread: number }
}

export type DepthLayerName = keyof Depth
export const DEPTH_ORDER: DepthLayerName[] = ['curve', 'parallax', 'haze', 'swirl', 'relief', 'shadow']
/** Of these, at most one may be on per card. */
export const STRUCTURE_LAYERS = ['swirl', 'relief'] as const
export type StructureLayer = (typeof STRUCTURE_LAYERS)[number]

/** The three choices the shuffle rolls before it rolls numbers (SPEC.md §2). */
export const COLOUR_MODES = ['mono', 'warm-cool', 'triad', 'free'] as const
export const COVERAGE_MODES = ['blend', 'block', 'flat'] as const
export const STRUCTURE_MODES = ['none', 'swirl', 'relief'] as const
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
  depth: {
    curve: FamilyLayer
    parallax: FamilyLayer
    haze: FamilyLayer
    swirl: FamilyLayer
    relief: FamilyLayer & { frequency: number; twist: number }
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
