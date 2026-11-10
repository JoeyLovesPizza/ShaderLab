import { MASS_PATHS, type MassMotion, type MassPath } from '../model/types'

/*
 * One mass's motion at a moment of the loop (SPEC.md §4, "Motion per
 * project and per mass"), the same maths as `pathOffset` and the pulse
 * and shift terms in masses.ts, so the tests can hold the loop seam in
 * node. Every term is a function of one angle, `a = TAU · t / loop ·
 * tempo + offset`, and tempo is whole, so t = 0 and t = loop give the
 * same values for every path.
 */

const TAU = Math.PI * 2

/** The index the shader reads for each path (u_massMotion[i].x). */
export const PATH_INDEX: Record<MassPath, number> = Object.fromEntries(MASS_PATHS.map((p, i) => [p, i])) as Record<MassPath, number>

/** The ellipse's minor axis against its major. */
export const ELLIPSE_RATIO = 0.45

export interface MassMotionSample {
  /** Unit offset (multiplied by the mass's drift radius), card units. */
  x: number
  y: number
  /** Multiplies the mass's size and its height bell. */
  scale: number
  /** Degrees the mass colour's OKLab a, b rotate by. */
  hue: number
}

/** The path's unit offset at angle `a`, oriented by `angle` degrees. A
    circle ignores the angle: turning it is only a phase shift. */
export function pathOffset(path: MassPath, a: number, angle: number): { x: number; y: number } {
  if (path === 'circle') return { x: Math.cos(a), y: Math.sin(a) }
  let ox: number
  let oy: number
  if (path === 'ellipse') {
    ox = Math.cos(a)
    oy = ELLIPSE_RATIO * Math.sin(a)
  } else if (path === 'line') {
    // A sway: sin eased again at its ends (zero slope and curvature at
    // ±1), so the turn reads as a settle, not a bounce.
    const s = Math.sin(a)
    ox = s * (1.5 - 0.5 * s * s)
    oy = 0
  } else {
    ox = Math.sin(a)
    oy = Math.sin(a) * Math.cos(a)
  }
  const r = (angle * Math.PI) / 180
  const c = Math.cos(r)
  const sn = Math.sin(r)
  return { x: c * ox - sn * oy, y: sn * ox + c * oy }
}

/** The mass's motion at `t` seconds into a loop of `loopSeconds`. */
export function massMotionAt(motion: MassMotion, t: number, loopSeconds: number, tempo: number, offset: number): MassMotionSample {
  const a = (TAU * t * tempo) / loopSeconds + offset
  const { x, y } = pathOffset(motion.path, a, motion.angle)
  return {
    x,
    y,
    // One swell per revolution, a quarter turn off the hue's sway.
    scale: 1 + motion.pulse * Math.sin(a),
    hue: motion.shift * Math.cos(a),
  }
}
