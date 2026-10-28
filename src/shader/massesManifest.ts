/*
 * The uniform table for `masses@1`: every value the passes read, with its
 * GLSL kind and a default. src/model/pack.ts fills it from a card's draft
 * and the family; src/shader/renderer.ts uploads it by kind to whichever
 * pass declares it (a pass without the uniform skips it) and reads the
 * Finish entries itself to decide which blur passes to run.
 */

export type UniformSpec =
  | { kind: 'float' | 'int'; default: number }
  | { kind: 'vec2' | 'vec3' | 'vec4'; default: number[] }
  /** A GLSL array: `count` elements of `components` floats, uploaded flat. */
  | { kind: 'array'; components: 1 | 2 | 3 | 4; count: number; default: number[] }

export const MAX_MASSES = 4

const zeros = (n: number) => new Array<number>(n).fill(0)

export const UNIFORMS = {
  // Base surface, OKLab, and its alpha where nothing covers it.
  u_base: { kind: 'vec3', default: [0.5, 0, 0] },
  u_baseAlpha: { kind: 'float', default: 1 },
  // Masses: colour in OKLab, position in card units, (size, softness, distance, phase offset), opacity.
  u_massCount: { kind: 'int', default: 0 },
  u_massLab: { kind: 'array', components: 3, count: MAX_MASSES, default: zeros(3 * MAX_MASSES) },
  u_massPos: { kind: 'array', components: 2, count: MAX_MASSES, default: zeros(2 * MAX_MASSES) },
  u_massParams: { kind: 'array', components: 4, count: MAX_MASSES, default: zeros(4 * MAX_MASSES) },
  u_massOpacity: { kind: 'array', components: 1, count: MAX_MASSES, default: zeros(MAX_MASSES) },
  // Depth stack, in order. An amount below zero means the layer is off.
  u_curve: { kind: 'float', default: -1 },
  u_parallax: { kind: 'float', default: -1 },
  u_haze: { kind: 'float', default: -1 },
  u_swirl: { kind: 'float', default: -1 },
  u_relief: { kind: 'float', default: -1 },
  u_reliefFreq: { kind: 'float', default: 85 },
  u_reliefTwist: { kind: 'float', default: 6 },
  u_shadow: { kind: 'float', default: -1 },
  u_shadowRect: { kind: 'vec4', default: [0.08, 0.1, 0.84, 0.8] },
  u_shadowOffset: { kind: 'float', default: 0.03 },
  u_shadowSpread: { kind: 'float', default: 0.1 },
  // Finish: read by the renderer to run the blur passes.
  u_motionOn: { kind: 'float', default: 0 },
  u_motionAngle: { kind: 'float', default: 20 },
  u_motionLength: { kind: 'float', default: 0.1 },
  u_motionIntensity: { kind: 'float', default: 0.6 },
  u_layerOn: { kind: 'float', default: 0 },
  u_layerRadius: { kind: 'float', default: 0.04 },
  u_layerIntensity: { kind: 'float', default: 0.6 },
  // Texture, mask, motion. Grain is static by default, hashed from the
  // seed; `u_grainAnimate` hashes it on every other frame instead.
  u_grain: { kind: 'float', default: 0.06 },
  u_grainSeed: { kind: 'float', default: 0 },
  u_grainAnimate: { kind: 'float', default: 0 },
  u_captionMask: { kind: 'float', default: 0 },
  u_captionZone: { kind: 'float', default: 0.3 },
  u_driftRadius: { kind: 'float', default: 0.03 },
  u_speed: { kind: 'float', default: 1 },
  /** The family's direction, degrees. */
  u_angle: { kind: 'float', default: 20 },
  // State deltas (SPEC.md §4, State grammar): added to every mass's L, and
  // multiplied into every mass's chroma.
  u_exposure: { kind: 'float', default: 0 },
  u_contrast: { kind: 'float', default: 1 },
} as const satisfies Record<string, UniformSpec>

export type UniformName = keyof typeof UNIFORMS
export type UniformValues = Record<UniformName, number | number[]>

export const UNIFORM_NAMES = Object.keys(UNIFORMS) as UniformName[]
export const specOf = (name: UniformName): UniformSpec => UNIFORMS[name]

export function defaultUniforms(): UniformValues {
  const out = {} as UniformValues
  for (const name of UNIFORM_NAMES) {
    const spec = specOf(name)
    out[name] = typeof spec.default === 'number' ? spec.default : [...spec.default]
  }
  return out
}
