/*
 * The Photo stage's continuum (SPEC.md §4, the Critic's numbers): one
 * fidelity dial 0..1 sets everything the shader needs. The pyramid has
 * four levels, Gaussian σ of W/6, W/16, W/40 and W/80 (W the card width);
 * the composite never samples finer than W/40, the W/80 level is kept for
 * the strokes' gradient. Each table is a polyline over fidelity, so a
 * retune is a number here.
 */

export const PHOTO_LEVELS = 4
/** σ of each pyramid level as a fraction of the card width (the Critic, 2026-11-04). */
export const PHOTO_SIGMAS = [1 / 10, 1 / 22, 1 / 50, 1 / 80] as const
/** The sampled photo's chroma is restored by this much, then capped by the family. */
export const PHOTO_CHROMA_BOOST = 1.3

type Table = readonly (readonly [number, number])[]

const lerpTable = (table: Table, x: number) => {
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1]
    const [x1, y1] = table[i]
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
  }
  return table[table.length - 1][1]
}

/** Which level the composite samples: 0.2 → W/10, 0.5 → W/22, 0.8 → W/50, 1 → W/80. */
const LEVEL: Table = [
  [0, 0],
  [0.2, 0],
  [0.5, 1],
  [0.8, 2],
  [1, 3],
]
/** How far the base leans to the photo. */
const MIX: Table = [
  [0, 0],
  [0.2, 0.25],
  [0.5, 0.6],
  [0.8, 0.9],
  [1, 1],
]
/** How much the masses still composite. */
const MASS_WEIGHT: Table = [
  [0, 1],
  [0.2, 1],
  [0.5, 0.6],
  [0.8, 0.25],
  [1, 0.1],
]
/** The photo's luminance in the height field (times the card's light height). */
const HEIGHT: Table = [
  [0, 0.3],
  [0.2, 0.3],
  [0.5, 1],
  [0.8, 0.7],
  [1, 0.5],
]
/** The light's amount. */
const LIGHT_SCALE: Table = [
  [0, 1],
  [0.5, 1],
  [0.8, 0.6],
  [1, 0.5],
]

export interface PhotoParams {
  level: number
  mix: number
  massWeight: number
  height: number
  lightScale: number
}

export function photoParams(fidelity: number): PhotoParams {
  const f = Math.min(1, Math.max(0, fidelity))
  return {
    level: lerpTable(LEVEL, f),
    mix: lerpTable(MIX, f),
    massWeight: lerpTable(MASS_WEIGHT, f),
    height: lerpTable(HEIGHT, f),
    lightScale: lerpTable(LIGHT_SCALE, f),
  }
}

/** The card's photo file, 1226 × 816: every photo is cover-fitted to it. */
export const PHOTO_WIDTH = 1226
export const PHOTO_HEIGHT = 816

/** Guardrails with a photo present (SPEC.md §4): the swirl's warp stays small. */
export const PHOTO_SWIRL_MAX = 0.1
