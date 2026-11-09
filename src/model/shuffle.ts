import {
  COLOUR_MODES,
  DEPTH_ORDER,
  L_MAX,
  L_MIN,
  L_RANGE_MIN,
  MAX_MASSES,
  STRUCTURE_LAYERS,
  type CardDraft,
  type ColourMode,
  type CoverageMode,
  type Family,
  type Mass,
  blobMass,
  type Modes,
  type Range,
  type StructureMode,
} from './types'
import { houseRanges, openLayers } from './house'
import type { Styled } from './project'
import { clampTo } from './validate'

/*
 * Shuffle (SPEC.md §2 and §4). From a seed, three choices first: colour
 * mode (mono / warm-cool / triad / free, with a bold flag), coverage
 * (blend / block / flat) and structure (none, weighted 40%, else swirl /
 * relief / grid). Each is re-rolled with probability `spread` and
 * otherwise kept from the origin, which is the project's style. Then the
 * numbers: the base and every unlocked mass, moved from the origin's own
 * values by `spread` within the family's ranges as the house pull widens
 * them (house.ts), and the depth layers' amounts the same way. At spread 0
 * the origin comes back and only the seed changes. Guardrails on every
 * roll: at least one dark or low-chroma mass unless coverage is flat, no
 * more than three hues, chroma within the cap (one bold mass excepted),
 * values within the tonal rules. Seeded, so a preset file reproduces
 * exactly; a mode Joe overrides on the panel is re-rolled from the same
 * seed with that choice forced.
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

/*
 * Rolled numbers at the precision the file and the panel hold them: four
 * places as the preset writer rounds, one for a hue, and two for a
 * position, the pad's step. Otherwise a roll, its file and the panel's
 * reading of it are three different drafts, and the gaps show as
 * "modified" and "by hand". Locked values are never rolled, so never
 * rounded.
 */
const r4 = (n: number) => Number(n.toFixed(4))
const r2 = (n: number) => Number(n.toFixed(2))
const r1 = (n: number) => Number(n.toFixed(1))
/** Rounds a rolled number, unless it is the origin's own (a file may hold
    more places than the roll does, and an unmoved value should stay as it is). */
const tidy = (round: (n: number) => number, n: number, centre?: number) => (centre !== undefined && n === centre ? n : round(n))
const floor4 = (n: number) => Math.floor(n * 1e4) / 1e4
const wrapHue = (h: number) => ((h % 360) + 360) % 360
const pick = <T>(rnd: Rnd, options: readonly T[]): T => options[Math.floor(rnd() * options.length)]

/**
 * Toward a random value in `range`, by `variety`, from `centre`. A centre
 * outside the range is let stand in proportion to how little the variety
 * moves it: at 0 the result is the centre, at 1 it is inside the range.
 */
function vary(rnd: Rnd, centre: number, range: Range, variety: number): number {
  const keep = 1 - variety
  const bounds: Range = [
    range[0] + (Math.min(range[0], centre) - range[0]) * keep,
    range[1] + (Math.max(range[1], centre) - range[1]) * keep,
  ]
  return clampTo(centre + (between(rnd, range) - centre) * variety, bounds)
}

/** Hue jitter in degrees: none at spread 0, a free hue (±180) at 1. */
const hueJitter = (spread: number) => HUE_JITTER * spread + (180 - HUE_JITTER) * spread ** 3

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
  /** The project's spread, 0..1. Without it the family's `variety`. */
  spread?: number
}

const GOVERNS: Record<RollScope, RegExp> = {
  all: /.*/,
  colour: /^(base\.(hue|chroma)|masses\.\d+\.(hue|chroma))$/,
  coverage: /^masses\.\d+\.(size|softness)$/,
  structure: /^depth\.(swirl|relief|strokes)\.(on|amount)$/,
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
  origin: Styled,
  draft: CardDraft,
  family: Family,
  seed: number,
  scope: RollScope,
  options: RollOptions = {},
): CardDraft {
  const rolled = shuffle(origin, draft, family, seed, options.forced, options.spread)
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

/*
 * The tonal rule (SPEC.md §2): every card needs L_RANGE_MIN of lightness
 * between its darkest and lightest region. Cell only badges a card that
 * misses it, so a wide spread could roll a blank card (flat hot pink, a
 * near-white sheet). A miss is re-rolled from a derived seed, up to eight
 * times, keeping the widest; the seed that won is the one stored, so the
 * file still reproduces. The bar is relative: three quarters of the
 * style's own estimated span, capped at the rule, so a style whose range
 * the estimate undercounts (a photo, a ridge's field) is still policed
 * against going blank without being forced past itself.
 */
const SPAN_TRIES = 8
const SPAN_KEEP = 0.75

export function shuffle(
  origin: Styled,
  draft: CardDraft,
  family: Family,
  seed: number,
  forced: Partial<Modes> = {},
  spread: number = family.variety,
): CardDraft {
  let best = shuffleOnce(origin, draft, family, seed, forced, spread)
  if (spread <= 0) return best
  const target = Math.min(L_RANGE_MIN, SPAN_KEEP * fieldSpan(origin))
  let bestSpan = fieldSpan(best)
  for (let i = 1; i < SPAN_TRIES && bestSpan < target; i++) {
    const next = shuffleOnce(origin, draft, family, (seed + i * 7919) % 1_000_000, forced, spread)
    const span = fieldSpan(next)
    if (span > bestSpan) {
      best = next
      bestSpan = span
    }
  }
  return best
}

/**
 * The card's lightness span, estimated on a 12 × 8 grid from the base and
 * the masses' plateau falloff (the shader's, without depth or the curve's
 * metric), so it runs in the shuffle and in node tests.
 */
export function fieldSpan(card: Pick<CardDraft, 'base' | 'masses'>, aspect = 1.5): number {
  let lo = Infinity
  let hi = -Infinity
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 12; gx++) {
      const px = ((gx + 0.5) / 12) * aspect
      const py = (gy + 0.5) / 8
      let L = card.base.value
      for (const m of card.masses) {
        let d: number
        if (m.kind === 'ridge') {
          // A ridge's ramp can fill the field across its chord (Silk fold),
          // which is most of that card's range; without it the estimate
          // called Silk fold blank and stopped policing its rolls.
          const fm = m.ramp.fieldMix
          if (fm > 0) {
            const cx = m.path.end.x - m.path.start.x
            const cy = m.path.end.y - m.path.start.y
            const t = Math.min(1, Math.max(0, ((px - m.path.start.x) * cx + (py - m.path.start.y) * cy) / Math.max(cx * cx + cy * cy, 1e-6)))
            const F = t < 0.5 ? m.ramp.start.value + (m.value - m.ramp.start.value) * t * 2 : m.value + (m.ramp.end.value - m.value) * (t - 0.5) * 2
            L += (F - L) * fm
          }
          d = Infinity
          for (let t = 0; t <= 16; t++) {
            const q = cubic(m.path, t / 16)
            d = Math.min(d, Math.hypot(px - q.x, py - q.y))
          }
        } else d = Math.hypot(px - m.x, py - m.y)
        const k = 4 + (1.6 - 4) * Math.min(1, Math.max(0, (m.softness - 0.4) / 0.5))
        const u = Math.max(d - 0.25 * m.size, 0) / m.size
        const f = Math.exp(-0.5 * u ** k)
        L += (m.value - L) * f
      }
      lo = Math.min(lo, L)
      hi = Math.max(hi, L)
    }
  }
  return hi - lo
}

function cubic(path: Mass['path'], t: number) {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const e = t * t * t
  return {
    x: a * path.start.x + b * path.control1.x + c * path.control2.x + e * path.end.x,
    y: a * path.start.y + b * path.control1.y + c * path.control2.y + e * path.end.y,
  }
}

function shuffleOnce(
  origin: Styled,
  draft: CardDraft,
  family: Family,
  seed: number,
  forced: Partial<Modes> = {},
  spread: number = family.variety,
): CardDraft {
  const rnd = mulberry32(seed)
  const s = Math.min(1, Math.max(0, spread))
  const open = 1 - family.housePull
  // The ranges the roll stays in: the family's, widened by the house pull,
  // and some disallowed layers permitted for this roll.
  const { family: fam } = openLayers(rnd, houseRanges(family))
  const next = structuredClone(draft)
  next.seed = seed

  // Each mode is re-rolled with probability `spread`, otherwise kept from
  // the origin; a mode forced on the panel always wins.
  const rolledModes = rollModes(rnd, fam, forced)
  const keepDice = [rnd(), rnd(), rnd()]
  const colourRolled = forced.colour !== undefined || keepDice[0] < s
  const coverageRolled = forced.coverage !== undefined || keepDice[1] < s
  const structureRolled = forced.structure !== undefined || keepDice[2] < s
  next.modes = {
    colour: colourRolled ? rolledModes.colour : origin.modes.colour,
    bold: forced.bold !== undefined || colourRolled ? rolledModes.bold : origin.modes.bold,
    coverage: coverageRolled ? rolledModes.coverage : origin.modes.coverage,
    structure: structureRolled ? rolledModes.structure : origin.modes.structure,
  }
  const { colour, bold, coverage, structure } = next.modes
  const hueBy = hueJitter(s)

  if (!draft.base.locked) {
    next.base.hue = wrapHue(jitter(rnd, origin.base.hue, hueBy))
    next.base.value = vary(rnd, origin.base.value, fam.base.value, s)
    next.base.chroma = Math.min(vary(rnd, origin.base.chroma, [0, fam.base.chromaMax], s), fam.base.chromaMax)
    next.base.hue = tidy(r1, next.base.hue, origin.base.hue)
    next.base.value = tidy(r4, next.base.value, origin.base.value)
    next.base.chroma = tidy(r4, next.base.chroma, origin.base.chroma)
  }
  const baseL = next.base.value

  // Mass count: by coverage when coverage was re-rolled, otherwise the
  // origin's. Never dropping a locked mass: the count reaches past the last
  // locked one, whatever its slot.
  const lastLocked = draft.masses.reduce((last, m, i) => (m.locked ? i + 1 : last), 0)
  const countRange: Range =
    coverage === 'blend'
      ? [Math.max(2, fam.masses.count[0]), Math.min(fam.masses.count[1], MAX_MASSES)]
      : coverage === 'block'
        ? [1, 2]
        : [1, 1]
  const count = Math.max(lastLocked, coverageRolled ? intBetween(rnd, countRange) : origin.masses.length)

  const massHues = hues(rnd, colour, next.base.hue, origin.masses.map((m) => m.hue), count)
  const boldIndex = bold ? Math.floor(rnd() * count) : -1
  // A mass keeps to the origin's own numbers (moved by the spread) unless
  // its coverage was re-rolled, when the new coverage's ranges decide.
  const geo =
    coverage === 'block'
      ? { size: [0.35, 0.65] as Range, softness: [0.4, 0.6] as Range, x: fam.masses.x, y: fam.masses.y }
      : coverage === 'flat'
        ? { size: [0.8, 1.1] as Range, softness: [0.8, 0.9] as Range, x: [1.35, 1.7] as Range, y: fam.masses.y }
        : {
            size: fam.masses.size,
            softness: [Math.max(0.7, fam.masses.softness[0]), fam.masses.softness[1]] as Range,
            // Positions come from the family's band (the right side, and
            // above or below the card) rather than the card's own, so
            // masses leave the frame instead of hovering in it.
            x: fam.masses.x,
            y: fam.masses.y,
          }
  const valueBy = VALUE_JITTER * 3 * s * (1 + 2 * open)
  const masses: Mass[] = []
  for (let i = 0; i < count; i++) {
    const current = draft.masses[i]
    if (current?.locked) {
      masses.push(current)
      continue
    }
    const from = origin.masses[i]
    const cap = i === boldIndex ? fam.masses.boldMax : fam.masses.chromaMax
    const chromaCentre = Math.min(from?.chroma ?? 0.08, cap)
    // Light or dark relative to the base: keep the origin's side, or roll one.
    const side = from ? (from.value > origin.base.value ? 1 : -1) : rnd() < 0.6 ? 1 : -1
    const valueCentre = from?.value ?? clampTo(baseL + side * 0.35, [L_MIN, L_MAX])
    const own = !!from && !coverageRolled
    const pick = (centre: number | undefined, range: Range) => (own && centre !== undefined ? vary(rnd, centre, range, s) : between(rnd, range))

    const size = pick(from?.size, geo.size)
    const softness = pick(from?.softness, geo.softness)
    const x = pick(from?.x, geo.x)
    const y = pick(from?.y, geo.y)
    const hue = from && !colourRolled ? wrapHue(jitter(rnd, from.hue, hueBy)) : massHues[i]

    const rolled = blobMass({
      hue: tidy(r1, hue, from?.hue),
      value: tidy(r4, clampTo(jitter(rnd, valueCentre, valueBy), [L_MIN, L_MAX]), from?.value),
      chroma: tidy(r4, clampTo(vary(rnd, chromaCentre, [0, cap], s), [0, cap]), from?.chroma),
      x: tidy(r2, x, from?.x),
      y: tidy(r2, y, from?.y),
      size: tidy(r4, size, from?.size),
      softness: tidy(r4, softness, from?.softness),
      distance: tidy(r4, clampTo(jitter(rnd, from?.distance ?? 0.5, 0.2 * s), [0, 1]), from?.distance),
      locked: false,
    })
    // A blob that did not move keeps its stored path and ramp, not the ones
    // blobMass derives (which differ by float dust).
    if (from?.kind === 'blob' && current?.kind !== 'ridge') {
      if (rolled.x === from.x && rolled.y === from.y) rolled.path = structuredClone(from.path)
      if (rolled.hue === from.hue && rolled.value === from.value && rolled.chroma === from.chroma) rolled.ramp = structuredClone(from.ramp)
    }
    // A ridge keeps its shape and ramp: the roll moves its colour and
    // its middle control point, not the curve Joe drew.
    if (current?.kind === 'ridge') {
      rolled.kind = 'ridge'
      rolled.path = structuredClone(current.path)
      rolled.ramp = structuredClone(current.ramp)
    }
    masses.push(rolled)
  }

  // Guardrail: a dark or low-chroma mass, unless the card is flat. At
  // spread 0 the style comes back as it is, anchored or not.
  // A project's style may break the rule on purpose (Paper's blue on navy
  // has no dark or grey mass); siblings keep that unless their colour or
  // coverage was rolled fresh. Forcing it drained Paper's blue to grey.
  const anchored = masses.some((m) => m.value <= baseL - DARK_BELOW_BASE || m.chroma < LOW_CHROMA)
  const originAnchored = origin.masses.some((m) => m.value <= origin.base.value - DARK_BELOW_BASE || m.chroma < LOW_CHROMA)
  const fresh = originAnchored || colourRolled || coverageRolled
  if (!anchored && fresh && coverage !== 'flat' && s > 0) {
    // Anchor the mass that costs the least to anchor, the lowest-chroma
    // unlocked one, not the first: the first is usually the card's hero
    // (Paper's blue), and draining it greys the whole card.
    let i = -1
    for (let j = 0; j < masses.length; j++) if (!masses[j].locked && (i < 0 || masses[j].chroma < masses[i].chroma)) i = j
    if (i >= 0) {
      const m = masses[i]
      // Rounded down, so the rounded value still sits under the line.
      if (baseL - DARK_BELOW_BASE >= L_MIN) m.value = floor4(clampTo(baseL - DARK_BELOW_BASE - 0.1 * rnd(), [L_MIN, L_MAX]))
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

  // Depth: the structure layer is the one rolled (the origin's own when the
  // mode was kept); the others stay as the origin has them, or are switched
  // by the dice at the spread, and every amount moves by the spread.
  for (const layer of DEPTH_ORDER) {
    const rule = fam.depth[layer]
    if (layer === 'swirl' || layer === 'relief' || layer === 'strokes') {
      const was = origin.depth[layer]
      const on = structureRolled ? structure === layer : was.on
      next.depth[layer].on = on
      // A layer coming on takes a fresh amount; otherwise it moves from its own.
      next.depth[layer].amount = on && !was.on ? between(rnd, rule.amount) : vary(rnd, was.amount, rule.amount, s)
      continue
    }
    if (!rule.allowed) {
      // Not the family's to switch: it stays as the origin has it.
      if (layer === 'light') {
        next.depth.light = { ...next.depth.light, ...origin.depth.light }
      } else {
        next.depth[layer].on = origin.depth[layer].on
        next.depth[layer].amount = origin.depth[layer].amount
      }
      continue
    }
    const reroll = rnd() < s
    const rolledOn = rnd() < (rule.on ? 0.85 : 0.3)
    if (layer === 'light') {
      // The light's amount range is its height range.
      next.depth.light.on = reroll ? rolledOn : origin.depth.light.on
      next.depth.light.height = tidy(r4, vary(rnd, origin.depth.light.height, rule.amount, s), origin.depth.light.height)
      continue
    }
    next.depth[layer].on = reroll ? rolledOn : origin.depth[layer].on
    next.depth[layer].amount = vary(rnd, origin.depth[layer].amount, rule.amount, s)
  }

  next.texture.grain = vary(rnd, origin.texture.grain, fam.texture.range, s)

  // Finish: at the spread, either blur is re-rolled and comes on one time
  // in five, when the family (or the house) allows; otherwise it stays.
  const fm = fam.finish.motionBlur
  if (rnd() < s) {
    next.finish.motionBlur.on = fm.allowed && rnd() < 0.2
    next.finish.motionBlur.length = between(rnd, fm.length)
    next.finish.motionBlur.intensity = between(rnd, fm.intensity)
  }
  const fl = fam.finish.layerBlur
  if (rnd() < s) {
    next.finish.layerBlur.on = fl.allowed && rnd() < 0.2
    next.finish.layerBlur.radius = between(rnd, fl.radius)
    next.finish.layerBlur.intensity = between(rnd, fl.intensity)
  }

  next.texture.grain = tidy(r4, next.texture.grain, origin.texture.grain)
  for (const layer of DEPTH_ORDER) if (layer !== 'light') next.depth[layer].amount = tidy(r4, next.depth[layer].amount, origin.depth[layer].amount)
  next.finish.motionBlur.length = r4(next.finish.motionBlur.length)
  next.finish.motionBlur.intensity = r4(next.finish.motionBlur.intensity)
  next.finish.layerBlur.radius = r4(next.finish.layerBlur.radius)
  next.finish.layerBlur.intensity = r4(next.finish.layerBlur.intensity)

  return next
}
