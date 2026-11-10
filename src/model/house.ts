import { DEPTH_ORDER, L_MAX, L_MIN, MAX_MASSES, type DepthLayerName, type Family, type Range } from './types'

/*
 * House pull (SPEC.md §4, "Spread and House pull, as the shuffle reads
 * them"). The family's ranges are what the house likes; the shuffle rolls
 * inside them widened by `1 − housePull` toward what the shader and the
 * validator allow. At 1 the family binds exactly as before; at 0 a project
 * may use anything that still validates. Pure, so the tests run it in node.
 * The legal limits are the validator's (validate.ts); a roll inside them
 * can never produce an invalid draft.
 */

/** Chroma ceiling the validator accepts. */
export const CHROMA_LEGAL = 0.4
/** Strokes' amount is a thickness: the validator allows 1, the panel stops at 0.2. */
export const STROKES_AMOUNT_LEGAL = 0.2
const SIZE_LEGAL: Range = [0.05, 4]
const SOFTNESS_LEGAL: Range = [0, 1]
const MOTION_LENGTH_LEGAL: Range = [0, 0.3]
const BLUR_RADIUS_LEGAL: Range = [0, 0.15]
const UNIT: Range = [0, 1]
const TEMPO_LEGAL: Range = [1, 4]
const MASS_TRAVEL_LEGAL: Range = [0, 2]
const PULSE_LEGAL: Range = [0, 0.3]
const SHIFT_LEGAL: Range = [0, 40]

// Exact at both ends, which a + (b - a) * t is not.
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t

/** `range` pulled toward `legal` by `open` (0 = as is, 1 = the legal range). */
function widen(range: Range, legal: Range, open: number): Range {
  return [lerp(range[0], Math.min(range[0], legal[0]), open), lerp(range[1], Math.max(range[1], legal[1]), open)]
}

/** The layers a roll may switch on, whatever the family allows. */
export type OpenableLayer = DepthLayerName | 'motionBlur' | 'layerBlur'

const LEGAL_AMOUNT: Record<DepthLayerName, Range> = {
  light: [0, 2],
  curve: UNIT,
  parallax: UNIT,
  haze: UNIT,
  swirl: UNIT,
  relief: UNIT,
  strokes: [0, STROKES_AMOUNT_LEGAL],
  shadow: UNIT,
}

/**
 * The family with every range widened by `1 − housePull`. `allowed` flags
 * are left as they are (see `openLayers`). At housePull 1 the result equals
 * the family.
 */
export function houseRanges(family: Family): Family {
  const open = Math.min(1, Math.max(0, 1 - family.housePull))
  const out = structuredClone(family)
  if (open === 0) return out
  out.base.value = widen(family.base.value, [L_MIN, L_MAX], open)
  out.base.chromaMax = lerp(family.base.chromaMax, CHROMA_LEGAL, open)
  const count = widen(family.masses.count, [1, MAX_MASSES], open)
  out.masses.count = [Math.round(count[0]), Math.round(count[1])]
  out.masses.size = widen(family.masses.size, SIZE_LEGAL, open)
  out.masses.softness = widen(family.masses.softness, SOFTNESS_LEGAL, open)
  out.masses.chromaMax = lerp(family.masses.chromaMax, CHROMA_LEGAL, open)
  out.masses.boldMax = lerp(family.masses.boldMax, CHROMA_LEGAL, open)
  for (const layer of DEPTH_ORDER) out.depth[layer].amount = widen(family.depth[layer].amount, LEGAL_AMOUNT[layer], open)
  out.finish.motionBlur.length = widen(family.finish.motionBlur.length, MOTION_LENGTH_LEGAL, open)
  out.finish.motionBlur.intensity = widen(family.finish.motionBlur.intensity, UNIT, open)
  out.finish.layerBlur.radius = widen(family.finish.layerBlur.radius, BLUR_RADIUS_LEGAL, open)
  out.finish.layerBlur.intensity = widen(family.finish.layerBlur.intensity, UNIT, open)
  // Motion: toward what the validator allows (tempo stays whole).
  out.motion.travelRange = widen(family.motion.travelRange, UNIT, open)
  const tempo = widen(family.motion.tempoRange, TEMPO_LEGAL, open)
  out.motion.tempoRange = [Math.round(tempo[0]), Math.round(tempo[1])]
  out.motion.mass.travel = widen(family.motion.mass.travel, MASS_TRAVEL_LEGAL, open)
  out.motion.mass.pulse = widen(family.motion.mass.pulse, PULSE_LEGAL, open)
  out.motion.mass.shift = widen(family.motion.mass.shift, SHIFT_LEGAL, open)
  return out
}

/** How likely a disallowed layer is to be permitted for one roll, at housePull 0. */
const OPEN_CHANCE = 0.5

/**
 * A copy of `family` where some disallowed layers are allowed for this
 * roll, each with probability `(1 − housePull) × 0.5`. Draws from `rnd`
 * only when the pull is below 1, so a roll at 1 reads the same stream it
 * always did.
 */
export function openLayers(rnd: () => number, family: Family): { family: Family; opened: OpenableLayer[] } {
  const open = Math.min(1, Math.max(0, 1 - family.housePull))
  const out = structuredClone(family)
  const opened: OpenableLayer[] = []
  if (open === 0) return { family: out, opened }
  const names: OpenableLayer[] = [...DEPTH_ORDER, 'motionBlur', 'layerBlur']
  for (const name of names) {
    const rule = name === 'motionBlur' || name === 'layerBlur' ? out.finish[name] : out.depth[name]
    if (rule.allowed) continue
    if (rnd() < open * OPEN_CHANCE) {
      rule.allowed = true
      opened.push(name)
    }
  }
  return { family: out, opened }
}
