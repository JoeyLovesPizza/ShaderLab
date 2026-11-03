import { oklchToLab } from '../palette/ramp'
import { MAX_MASSES, defaultUniforms, type UniformValues } from '../shader/massesManifest'
import { mulberry32 } from './shuffle'
import { withMassShape, type CardDraft, type Family } from './types'

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
  const kind: number[] = []
  const start: number[] = []
  const end: number[] = []
  const ctrl1: number[] = []
  const ctrl2: number[] = []
  const labStart: number[] = []
  const labEnd: number[] = []
  const fieldMix: number[] = []
  masses.forEach((raw, i) => {
    const mass = withMassShape(raw)
    lab.push(...oklchToLab(mass.hue, mass.value, mass.chroma))
    pos.push(mass.x, mass.y)
    params.push(mass.size * aspect, mass.softness, mass.distance, phases[i])
    opacity.push(1)
    kind.push(mass.kind === 'ridge' ? 1 : 0)
    start.push(mass.path.start.x, mass.path.start.y)
    end.push(mass.path.end.x, mass.path.end.y)
    ctrl1.push(mass.path.control1.x, mass.path.control1.y)
    ctrl2.push(mass.path.control2.x, mass.path.control2.y)
    labStart.push(...oklchToLab(mass.ramp.start.hue, mass.ramp.start.value, mass.ramp.start.chroma))
    labEnd.push(...oklchToLab(mass.ramp.end.hue, mass.ramp.end.value, mass.ramp.end.chroma))
    fieldMix.push(mass.kind === 'ridge' ? mass.ramp.fieldMix : 0)
  })
  const fill = (arr: number[], n: number) => {
    while (arr.length < n) arr.push(0)
    return arr
  }
  u.u_massCount = masses.length
  u.u_massLab = fill(lab, 3 * MAX_MASSES)
  u.u_massPos = fill(pos, 2 * MAX_MASSES)
  u.u_massParams = fill(params, 4 * MAX_MASSES)
  u.u_massOpacity = fill(opacity, MAX_MASSES)
  u.u_massKind = fill(kind, MAX_MASSES)
  u.u_massStart = fill(start, 2 * MAX_MASSES)
  u.u_massEnd = fill(end, 2 * MAX_MASSES)
  u.u_massCtrl1 = fill(ctrl1, 2 * MAX_MASSES)
  u.u_massCtrl2 = fill(ctrl2, 2 * MAX_MASSES)
  u.u_massLabStart = fill(labStart, 3 * MAX_MASSES)
  u.u_massLabEnd = fill(labEnd, 3 * MAX_MASSES)
  u.u_massFieldMix = fill(fieldMix, MAX_MASSES)

  const amount = (layer: { on: boolean; amount: number }) => (layer.on ? layer.amount : -1)
  const d = draft.depth
  // The one light is the family's; a card only says how tall its field is.
  u.u_light = d.light.on ? d.light.height : -1
  u.u_lightAngle = family.light.followAngle ? family.motion.angle : family.light.angle
  u.u_lightElevation = family.light.elevation
  u.u_lightAmount = family.light.amount
  u.u_curve = amount(d.curve)
  u.u_parallax = amount(d.parallax)
  u.u_haze = amount(d.haze)
  u.u_swirl = amount(d.swirl)
  u.u_swirlScale = d.swirl.scale
  u.u_relief = amount(d.relief)
  u.u_reliefFreq = d.relief.frequency
  u.u_reliefTwist = d.relief.twist
  u.u_strokes = amount(d.strokes)
  u.u_strokesAngle = d.strokes.followAngle ? family.motion.angle : d.strokes.direction
  u.u_strokesSize = d.strokes.size
  u.u_strokesDensity = d.strokes.density
  u.u_strokesTaper = d.strokes.taper
  u.u_strokesChaos = d.strokes.chaos
  u.u_strokesFollow = d.strokes.follow
  // The fibres' own motion, scaled by the one Motion dial like the drift.
  u.u_strokesMotion = Math.min(1, d.strokes.motion * (family.motion.amount / 0.6))
  u.u_shadow = amount(d.shadow)
  u.u_shadowRect = [...d.shadow.rect]
  u.u_shadowOffset = d.shadow.offset
  u.u_shadowSpread = d.shadow.spread

  const f = draft.finish
  u.u_motionOn = f.motionBlur.on ? 1 : 0
  u.u_motionAngle = f.motionBlur.followAngle ? family.motion.angle : f.motionBlur.angle
  u.u_motionLength = f.motionBlur.length
  u.u_motionIntensity = f.motionBlur.intensity
  // Strokes are smeared, not drawn: a short motion blur along their angle
  // turns the lines into fibres (the Critic). It takes the Finish pass over
  // while Strokes is on.
  if (d.strokes.on) {
    u.u_motionOn = 1
    u.u_motionAngle = u.u_strokesAngle
    u.u_motionLength = 0.03
    u.u_motionIntensity = 0.85
  }
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
