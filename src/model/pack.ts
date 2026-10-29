import { oklchToLab } from '../palette/ramp'
import { MAX_MASSES, defaultUniforms, type UniformValues } from '../shader/massesManifest'
import { mulberry32 } from './shuffle'
import type { CardDraft, Family } from './types'

/*
 * A card's draft plus the family, as the uniforms `masses@1` reads. All
 * the colour conversion to OKLab happens here, once per edit, so the
 * shader only mixes.
 */

const TAU = Math.PI * 2

/** The hero card's shape, for a caller without a canvas to hand. */
export const DEFAULT_ASPECT = 613 / 408

/** Each mass's phase offset on its drift circle, from the seed, so two
    cards with the same arrangement never breathe in step. */
function phaseOffsets(seed: number): number[] {
  const rnd = mulberry32(seed * 31 + 7)
  return Array.from({ length: MAX_MASSES }, () => rnd() * TAU)
}

/**
 * `aspect` is the card's width over its height. The shader measures in
 * height units (x runs 0..aspect), while a file's `size` is in card
 * widths, so sizes are scaled by the aspect on the way in. Positions are
 * card units in both and pass straight through. Blur lengths and radii
 * stay in card widths; the renderer turns them into pixels.
 */
export function packUniforms(draft: CardDraft, family: Family, aspect = DEFAULT_ASPECT): UniformValues {
  const u = defaultUniforms()
  u.u_base = oklchToLab(draft.base.hue, draft.base.value, draft.base.chroma)
  // Alpha and per-mass opacity are plumbed through the passes but not in
  // the schema (a cancelled job); every card is opaque.
  u.u_baseAlpha = 1

  // Darkest first: the last mass mixed has the final say over the card, and
  // a shadow mixed last dragged every lighter mass down with it (Critic).
  // The file keeps its own order; only the compositing order is sorted.
  const masses = draft.masses
    .map((mass, i) => ({ mass, i }))
    .sort((a, b) => a.mass.value - b.mass.value || a.i - b.i)
    .map(({ mass }) => mass)
    .slice(0, MAX_MASSES)
  const phases = phaseOffsets(draft.seed)
  const lab: number[] = []
  const pos: number[] = []
  const params: number[] = []
  const opacity: number[] = []
  masses.forEach((mass, i) => {
    lab.push(...oklchToLab(mass.hue, mass.value, mass.chroma))
    pos.push(mass.x, mass.y)
    params.push(mass.size * aspect, mass.softness, mass.distance, phases[i])
    opacity.push(1)
  })
  while (lab.length < 3 * MAX_MASSES) lab.push(0)
  while (pos.length < 2 * MAX_MASSES) pos.push(0)
  while (params.length < 4 * MAX_MASSES) params.push(0)
  while (opacity.length < MAX_MASSES) opacity.push(0)
  u.u_massCount = masses.length
  u.u_massLab = lab
  u.u_massPos = pos
  u.u_massParams = params
  u.u_massOpacity = opacity

  const amount = (layer: { on: boolean; amount: number }) => (layer.on ? layer.amount : -1)
  const d = draft.depth
  u.u_curve = amount(d.curve)
  u.u_parallax = amount(d.parallax)
  u.u_haze = amount(d.haze)
  u.u_swirl = amount(d.swirl)
  u.u_relief = amount(d.relief)
  u.u_reliefFreq = d.relief.frequency
  u.u_reliefTwist = d.relief.twist
  u.u_shadow = amount(d.shadow)
  u.u_shadowRect = [...d.shadow.rect]
  u.u_shadowOffset = d.shadow.offset
  u.u_shadowSpread = d.shadow.spread

  const f = draft.finish
  u.u_motionOn = f.motionBlur.on ? 1 : 0
  u.u_motionAngle = f.motionBlur.followAngle ? family.motion.angle : f.motionBlur.angle
  u.u_motionLength = f.motionBlur.length
  u.u_motionIntensity = f.motionBlur.intensity
  u.u_layerOn = f.layerBlur.on ? 1 : 0
  u.u_layerRadius = f.layerBlur.radius
  u.u_layerIntensity = f.layerBlur.intensity

  u.u_grain = draft.texture.grain
  u.u_grainSeed = (draft.seed % 9973) + 1
  u.u_grainAnimate = family.texture.animate ? 1 : 0
  u.u_captionMask = draft.captionMask ? 1 : 0
  u.u_captionZone = family.captionZone
  // The Motion dial: one knob. It scales the drift radius (card widths,
  // so × aspect into the shader's units) about its 0.6 default, and picks
  // the revolutions per loop, which must stay whole for a seamless loop.
  const motion = family.motion.amount
  u.u_driftRadius = family.motion.driftRadius * aspect * (motion / 0.6)
  u.u_speed = motion < 0.45 ? 1 : motion < 0.85 ? 2 : 3
  u.u_angle = family.motion.angle
  return u
}
