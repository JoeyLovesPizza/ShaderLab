import {
  COLOUR_MODES,
  DEPTH_ORDER,
  L_MAX,
  L_MIN,
  STRUCTURE_LAYERS,
  type CardDraft,
  type ColourMode,
  type CoverageMode,
  type Family,
  type Mass,
  type Modes,
  type Preset,
  type Range,
  type StructureMode,
} from './types'
import { clampTo } from './validate'

/*
 * Shuffle (SPEC.md §2). From a seed, three choices first: colour mode
 * (mono / warm-cool / triad / free, with a bold flag), coverage (blend /
 * block / flat) and structure (none, weighted 40%, else swirl / relief /
 * grid). Then the numbers: the base and every unlocked mass within the
 * family's bounds, in the shapes those choices call for, and the depth
 * layers' amounts within range. `variety` scales how far the numbers leave
 * the card's own values. Guardrails on every roll: at least one dark or
 * low-chroma mass unless coverage is flat, no more than three hues, chroma
 * within the cap (one bold mass excepted), values within the tonal rules.
 * Seeded, so a preset file reproduces exactly; a mode Joe overrides on the
 * panel is re-rolled from the same seed with that choice forced.
 */

const HUE_JITTER = 12
const VALUE_JITTER = 0.05
/** A dark mass sits at least this far under the base. */
const DARK_BELOW_BASE = 0.15
/** Or carries less chroma than this. */
const LOW_CHROMA = 0.05
const MAX_HUES = 3

/** mulberry32: a small, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const newSeed = () => Math.floor(Math.random() * 1_000_000)

type Rnd = () => number
const between = (rnd: Rnd, [min, max]: Range) => min + (max - min) * rnd()
const intBetween = (rnd: Rnd, [min, max]: Range) => Math.floor(min + (max - min + 1) * rnd())
const jitter = (rnd: Rnd, centre: number, by: number) => centre + (rnd() * 2 - 1) * by
const wrapHue = (h: number) => ((h % 360) + 360) % 360
const pick = <T>(rnd: Rnd, options: readonly T[]): T => options[Math.floor(rnd() * options.length)]

/** Toward a random value in `range`, by `variety`, from `centre`. */
const vary = (rnd: Rnd, centre: number, range: Range, variety: number) =>
  clampTo(centre + (between(rnd, range) - centre) * variety, range)

/** Hue distance on the circle, 0..180. */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(wrapHue(a) - wrapHue(b))
  return Math.min(d, 360 - d)
}

export function rollModes(rnd: Rnd, family: Family, forced: Partial<Modes> = {}): Modes {
  const colour = forced.colour ?? pick(rnd, COLOUR_MODES)
  const bold = forced.bold ?? (family.masses.boldAllowed && rnd() < 0.25)
  const coverageRoll = rnd()
  const coverage: CoverageMode = forced.coverage ?? (coverageRoll < 0.5 ? 'blend' : coverageRoll < 0.8 ? 'block' : 'flat')
  let structure: StructureMode
  if (forced.structure) structure = forced.structure
  else {
    const allowed = STRUCTURE_LAYERS.filter((name) => family.depth[name].allowed)
    // Flat cards lean on a structure layer; the rest take one 60% of the time.
    const want = allowed.length > 0 && rnd() < (coverage === 'flat' ? 0.85 : 0.6)
    structure = want ? pick(rnd, allowed) : 'none'
  }
  return { colour, bold, coverage, structure }
}

/** The hues a colour mode gives `count` masses around a card's hue. */
function hues(rnd: Rnd, mode: ColourMode, baseHue: number, originHues: number[], count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    switch (mode) {
      case 'mono':
        out.push(wrapHue(jitter(rnd, baseHue, 6)))
        break
      case 'warm-cool': {
        const across = baseHue + (i % 2 === 0 ? 0 : between(rnd, [120, 180]) * (rnd() < 0.5 ? 1 : -1))
        out.push(wrapHue(jitter(rnd, across, HUE_JITTER)))
        break
      }
      case 'triad':
        out.push(wrapHue(jitter(rnd, baseHue + (i % 3) * 120, HUE_JITTER)))
        break
      case 'free':
        // Each its own hue, but a card keeps its character: the origin's
        // hues when it has them, random past that, never more than three.
        out.push(wrapHue(i < originHues.length ? jitter(rnd, originHues[i], HUE_JITTER * 2) : i < MAX_HUES ? rnd() * 360 : out[i % MAX_HUES]))
        break
    }
  }
  return out
}

/** What a roll is allowed to touch. */
export type RollScope = 'all' | 'colour' | 'coverage' | 'structure'

export interface RollOptions {
  /** Modes to force rather than roll (a panel override). */
  forced?: Partial<Modes>
  /** Hand-edited leaf paths; never rolled unless `ignoreDirty`. */
  dirty?: ReadonlySet<string>
  /** "Shuffle (all fields)": dirty marks are ignored, locks are not. */
  ignoreDirty?: boolean
}

const GOVERNS: Record<RollScope, RegExp> = {
  all: /.*/,
  colour: /^(base\.(hue|chroma)|masses\.\d+\.(hue|chroma))$/,
  coverage: /^masses\.\d+\.(size|softness)$/,
  structure: /^depth\.(swirl|relief)\.(on|amount)$/,
}

const MASS_FIELDS = ['hue', 'value', 'chroma', 'x', 'y', 'size', 'softness', 'distance'] as const
const BASE_FIELDS = ['hue', 'value', 'chroma'] as const

/**
 * A roll with a scope: the full candidate from `shuffle` is merged into the
 * draft only on the fields the scope governs, never on a locked item and
 * never on a dirty field (unless told to ignore dirty). A mode change thus
 * re-rolls only what that mode is about (coverage: mass count, sizes,
 * softness; structure: which structure layer and its amount; colour mode:
 * hues and chroma, never value) and leaves Joe's hand edits alone.
 */
export function rollScoped(
  origin: Preset,
  draft: CardDraft,
  family: Family,
  seed: number,
  scope: RollScope,
  options: RollOptions = {},
): CardDraft {
  const rolled = shuffle(origin, draft, family, seed, options.forced)
  const dirty = options.dirty ?? new Set<string>()
  const governs = GOVERNS[scope]
  const may = (path: string) => governs.test(path) && (options.ignoreDirty || !dirty.has(path))
  const result = structuredClone(draft)

  // Modes: a scope adopts the modes it is about; Shuffle adopts them all.
  if (scope === 'all') result.modes = rolled.modes
  if (scope === 'colour') {
    result.modes.colour = rolled.modes.colour
    result.modes.bold = rolled.modes.bold
  }
  if (scope === 'coverage') result.modes.coverage = rolled.modes.coverage
  if (scope === 'structure') result.modes.structure = rolled.modes.structure
  if (scope === 'all') result.seed = rolled.seed

  if (!draft.base.locked) {
    for (const key of BASE_FIELDS) if (may(`base.${key}`)) result.base[key] = rolled.base[key]
  }

  // Masses: the count may change under Shuffle or a coverage change, but a
  // locked mass, or one carrying a hand edit, is never dropped.
  const countMayChange = scope === 'all' || scope === 'coverage'
  const protectedMass = (i: number) =>
    draft.masses[i]?.locked ||
    (!options.ignoreDirty && MASS_FIELDS.some((f) => dirty.has(`masses.${i}.${f}`)))
  const masses: Mass[] = []
  const len = countMayChange ? Math.max(draft.masses.length, rolled.masses.length) : draft.masses.length
  for (let i = 0; i < len; i++) {
    const current = draft.masses[i]
    const next = rolled.masses[i]
    if (current && current.locked) {
      masses.push(current)
      continue
    }
    if (!current && next) {
      masses.push(next)
      continue
    }
    if (current && !next) {
      if (!countMayChange || protectedMass(i)) masses.push(current)
      continue
    }
    if (current && next) {
      const merged = { ...current }
      for (const f of MASS_FIELDS) if (may(`masses.${i}.${f}`)) merged[f] = next[f]
      masses.push(merged)
    }
  }
  result.masses = masses

  for (const layer of DEPTH_ORDER) {
    const from = rolled.depth[layer] as unknown as Record<string, unknown>
    const to = result.depth[layer] as unknown as Record<string, unknown>
    for (const key of Object.keys(from)) if (may(`depth.${layer}.${key}`)) to[key] = from[key]
  }
  if (may('texture.grain')) result.texture.grain = rolled.texture.grain
  for (const blur of ['motionBlur', 'layerBlur'] as const) {
    const from = rolled.finish[blur] as unknown as Record<string, unknown>
    const to = result.finish[blur] as unknown as Record<string, unknown>
    for (const key of Object.keys(from)) if (may(`finish.${blur}.${key}`)) to[key] = from[key]
  }
  return result
}

export function shuffle(
  origin: Preset,
  draft: CardDraft,
  family: Family,
  seed: number,
  forced: Partial<Modes> = {},
): CardDraft {
  const rnd = mulberry32(seed)
  const variety = family.variety
  const next = structuredClone(draft)
  next.seed = seed
  next.modes = rollModes(rnd, family, forced)
  const { colour, bold, coverage, structure } = next.modes

  if (!draft.base.locked) {
    next.base.hue = wrapHue(jitter(rnd, origin.base.hue, HUE_JITTER * (0.5 + variety)))
    next.base.value = vary(rnd, origin.base.value, family.base.value, variety)
    next.base.chroma = Math.min(vary(rnd, origin.base.chroma, [0, family.base.chromaMax], variety), family.base.chromaMax)
  }
  const baseL = next.base.value

  // Mass count by coverage, never dropping a locked mass.
  const locked = draft.masses.filter((m) => m.locked).length
  const countRange: Range =
    coverage === 'blend'
      ? [Math.max(2, family.masses.count[0]), Math.min(3, family.masses.count[1])]
      : coverage === 'block'
        ? [1, 2]
        : [1, 1]
  const count = Math.max(locked, intBetween(rnd, countRange))

  const massHues = hues(rnd, colour, next.base.hue, origin.masses.map((m) => m.hue), count)
  const boldIndex = bold ? Math.floor(rnd() * count) : -1
  const masses: Mass[] = []
  for (let i = 0; i < count; i++) {
    const current = draft.masses[i]
    if (current?.locked) {
      masses.push(current)
      continue
    }
    const from = origin.masses[i]
    const cap = i === boldIndex ? family.masses.boldMax : family.masses.chromaMax
    const chromaCentre = Math.min(from?.chroma ?? 0.08, cap)
    // Light or dark relative to the base: keep the origin's side, or roll one.
    const side = from ? (from.value > origin.base.value ? 1 : -1) : rnd() < 0.6 ? 1 : -1
    const valueCentre = from?.value ?? clampTo(baseL + side * 0.35, [L_MIN, L_MAX])

    let size: number
    let softness: number
    let x: number
    let y: number
    if (coverage === 'block') {
      size = between(rnd, [0.35, 0.65])
      softness = between(rnd, [0.4, 0.6])
      x = between(rnd, family.masses.x)
      y = between(rnd, family.masses.y)
    } else if (coverage === 'flat') {
      // One mass, mostly off the card, so the base and grain carry it.
      size = between(rnd, [0.8, 1.1])
      softness = between(rnd, [0.8, 0.9])
      x = between(rnd, [1.35, 1.7])
      y = between(rnd, family.masses.y)
    } else {
      size = vary(rnd, from?.size ?? 0.45, family.masses.size, variety)
      const softRange: Range = [Math.max(0.7, family.masses.softness[0]), family.masses.softness[1]]
      softness = vary(rnd, from?.softness ?? 0.8, softRange, variety)
      // Positions come from the family's band (the right side, and above
      // or below the card) rather than the card's own, so masses leave the
      // frame instead of hovering in it.
      x = between(rnd, family.masses.x)
      y = between(rnd, family.masses.y)
    }

    masses.push({
      hue: massHues[i],
      value: clampTo(jitter(rnd, valueCentre, VALUE_JITTER * (1 + 2 * variety)), [L_MIN, L_MAX]),
      chroma: clampTo(vary(rnd, chromaCentre, [0, cap], variety), [0, cap]),
      x,
      y,
      size,
      softness,
      distance: clampTo(jitter(rnd, from?.distance ?? 0.5, 0.2), [0, 1]),
      locked: false,
    })
  }

  // Guardrail: a dark or low-chroma mass, unless the card is flat.
  const anchored = masses.some((m) => m.value <= baseL - DARK_BELOW_BASE || m.chroma < LOW_CHROMA)
  if (!anchored && coverage !== 'flat') {
    const i = masses.findIndex((m) => !m.locked)
    if (i >= 0) {
      const m = masses[i]
      if (baseL - DARK_BELOW_BASE >= L_MIN) m.value = clampTo(baseL - DARK_BELOW_BASE - 0.1 * rnd(), [L_MIN, L_MAX])
      else m.chroma = Math.min(m.chroma, LOW_CHROMA * 0.6)
    }
  }
  // Guardrail: no more than three hues (mono and warm-cool can't exceed it).
  const distinct: number[] = []
  for (const m of masses) {
    const near = distinct.find((h) => hueGap(h, m.hue) < 20)
    if (near !== undefined) continue
    if (distinct.length < MAX_HUES) distinct.push(m.hue)
    else if (!m.locked) m.hue = distinct[distinct.length - 1]
  }
  next.masses = masses

  // Depth: the free layers roll within range by their family defaults; the
  // structure layer is the one rolled, the others off.
  for (const layer of DEPTH_ORDER) {
    const rule = family.depth[layer]
    if (layer === 'swirl' || layer === 'relief') {
      next.depth[layer].on = structure === layer
      next.depth[layer].amount = between(rnd, rule.amount)
      continue
    }
    if (layer === 'shadow') continue
    next.depth[layer].on = rule.allowed ? rnd() < (rule.on ? 0.85 : 0.3) : rule.on
    next.depth[layer].amount = vary(rnd, draft.depth[layer].amount, rule.amount, variety)
  }

  next.texture.grain = vary(rnd, family.texture.grain, family.texture.range, variety)

  // Finish: either blur comes on one time in five, when the family allows.
  const fm = family.finish.motionBlur
  next.finish.motionBlur.on = fm.allowed && rnd() < 0.2
  next.finish.motionBlur.length = between(rnd, fm.length)
  next.finish.motionBlur.intensity = between(rnd, fm.intensity)
  const fl = family.finish.layerBlur
  next.finish.layerBlur.on = fl.allowed && rnd() < 0.2
  next.finish.layerBlur.radius = between(rnd, fl.radius)
  next.finish.layerBlur.intensity = between(rnd, fl.intensity)

  return next
}
