import { describe, expect, it } from 'vitest'
import { newBackgroundPreset } from '../../src/model/background'
import { houseRanges } from '../../src/model/house'
import { packUniforms, DEFAULT_ASPECT } from '../../src/model/pack'
import { shuffle } from '../../src/model/shuffle'
import { CARD_MOTION_DEFAULT, LINK_PATHS, MASS_MOTION_DEFAULT, MASS_PATHS, type CardDraft, type MassMotion } from '../../src/model/types'
import { migrateOverlay } from '../../src/model/validate'
import { FIELD_FRAG } from '../../src/shader/masses'
import { ELLIPSE_RATIO, massMotionAt, pathOffset } from '../../src/shader/motion'
import { clone, draftOf, loadFamily, loadPresets, loadProjects } from '../helpers'

/*
 * Motion per project and per mass (SPEC.md §4, job 4): the loop joins for
 * every path, the defaults are the drift every card had before, and the
 * shuffle rolls motion like any other stage.
 */

type Obj = Record<string, unknown>
const family = loadFamily()
const nine = loadPresets().filter((p) => p.id !== 'placeholder')
const projects = loadProjects()

describe('massMotionAt', () => {
  const loud = (path: MassMotion['path']): MassMotion => ({ path, travel: 1.4, angle: 37, pulse: 0.3, shift: 40 })

  it('gives the same offset, pulse and hue at t = 0 and t = loop for every path and tempo', () => {
    for (const path of MASS_PATHS) {
      for (const tempo of [1, 2, 3, 4]) {
        for (const loop of [8, 12, 23.5]) {
          for (const offset of [0, 1.3, 5.9]) {
            const a = massMotionAt(loud(path), 0, loop, tempo, offset)
            const b = massMotionAt(loud(path), loop, loop, tempo, offset)
            expect(b.x).toBeCloseTo(a.x, 9)
            expect(b.y).toBeCloseTo(a.y, 9)
            expect(b.scale).toBeCloseTo(a.scale, 9)
            expect(b.hue).toBeCloseTo(a.hue, 9)
          }
        }
      }
    }
  })

  it('the circle is the old drift, cos and sin of the phase', () => {
    for (const t of [0, 1.7, 6, 11.2]) {
      const a = (Math.PI * 2 * t * 2) / 12 + 0.4
      const m = massMotionAt(MASS_MOTION_DEFAULT, t, 12, 2, 0.4)
      expect(m.x).toBeCloseTo(Math.cos(a), 12)
      expect(m.y).toBeCloseTo(Math.sin(a), 12)
      expect(m.scale).toBe(1)
      expect(Math.abs(m.hue)).toBe(0)
    }
  })

  it('pulse and shift stay within their amounts; the line stays on its axis', () => {
    for (let t = 0; t < 12; t += 0.25) {
      const m = massMotionAt(loud('line'), t, 12, 1, 0)
      expect(Math.abs(m.scale - 1)).toBeLessThanOrEqual(0.3 + 1e-12)
      expect(Math.abs(m.hue)).toBeLessThanOrEqual(40 + 1e-12)
      // Along 37°: the offset is parallel to (cos 37°, sin 37°), at most 1 long.
      const r = (37 * Math.PI) / 180
      expect(Math.abs(m.x * Math.sin(r) - m.y * Math.cos(r))).toBeLessThan(1e-12)
      expect(Math.hypot(m.x, m.y)).toBeLessThanOrEqual(1 + 1e-12)
    }
  })

  it('the line settles at its ends: no speed at the turn', () => {
    const at = (a: number) => pathOffset('line', a, 0).x
    const h = 1e-4
    expect(Math.abs((at(Math.PI / 2 + h) - at(Math.PI / 2 - h)) / (2 * h))).toBeLessThan(1e-6)
  })

  it('the GLSL mirrors the TS (same constants in pathOffset)', () => {
    expect(FIELD_FRAG).toContain(`${ELLIPSE_RATIO} * sin(a)`)
    expect(FIELD_FRAG).toContain('s * (1.5 - 0.5 * s * s)')
    expect(FIELD_FRAG).toContain('vec2(sin(a), sin(a) * cos(a))')
    expect(FIELD_FRAG).toContain('prm.x * (1.0 + mm.w * sin(a))')
    expect(FIELD_FRAG).toContain('u_massShift[i] * cos(a)')
  })
})

describe('defaults pack to the drift every card had before', () => {
  it('a card without motion packs to travel 0.6 and two revolutions, every mass a still circle', () => {
    for (const preset of nine) {
      const overlay = clone(draftOf(preset)) as unknown as Obj
      delete overlay.motion
      for (const m of overlay.masses as Obj[]) delete m.motion
      const migrated = migrateOverlay(preset, overlay)!
      expect(migrated.draft.motion).toEqual(CARD_MOTION_DEFAULT)
      const u = packUniforms(migrated.draft, family)
      // What pack.ts gave before: driftRadius × aspect × (amount 0.6 / 0.6), speed 2.
      expect(u.u_driftRadius).toBe(family.motion.driftRadius * DEFAULT_ASPECT * (0.6 / 0.6))
      expect(u.u_speed).toBe(2)
      const motion = u.u_massMotion as number[]
      const shift = u.u_massShift as number[]
      for (let i = 0; i < preset.masses.length; i++) {
        expect(motion.slice(i * 4, i * 4 + 4)).toEqual([0, 1, 0, 0])
        expect(shift[i]).toBe(0)
      }
    }
  })

  it('the files hold the defaults, so nothing moves differently from before', () => {
    for (const preset of nine) {
      expect(preset.motion).toEqual(CARD_MOTION_DEFAULT)
      for (const m of preset.masses) expect(m.motion).toEqual(MASS_MOTION_DEFAULT)
    }
    for (const project of projects) expect(project.style.motion).toEqual(CARD_MOTION_DEFAULT)
  })

  it('tempo packs whole', () => {
    const draft: CardDraft = { ...draftOf(nine[0]), motion: { travel: 0.3, tempo: 3 } }
    expect(packUniforms(draft, family).u_speed).toBe(3)
  })
})

describe('the shuffle rolls motion', () => {
  it('at spread 0 the card and every mass keep the style\'s motion', () => {
    for (const preset of nine) {
      const origin = clone(preset)
      origin.motion = { travel: 0.42, tempo: 3 }
      origin.masses.forEach((m, i) => (m.motion = { path: MASS_PATHS[i % 4], travel: 1.23, angle: 200, pulse: 0.07, shift: 12.5 }))
      for (const seed of [1, 99, 4242]) {
        const rolled = shuffle(origin, draftOf(origin), family, seed, {}, 0)
        expect(rolled.motion).toEqual(origin.motion)
        rolled.masses.forEach((m, i) => expect(m.motion).toEqual(origin.masses[i].motion))
      }
    }
  })

  it('at spread > 0 it rolls within the house ranges, and tempo stays whole', () => {
    const ranges = houseRanges(family).motion
    const seen = new Set<string>()
    for (const preset of nine) {
      for (let seed = 1; seed < 200; seed += 7) {
        const rolled = shuffle(preset, draftOf(preset), family, seed, {}, 1)
        expect(Number.isInteger(rolled.motion.tempo)).toBe(true)
        expect(rolled.motion.tempo).toBeGreaterThanOrEqual(ranges.tempoRange[0])
        expect(rolled.motion.tempo).toBeLessThanOrEqual(ranges.tempoRange[1])
        expect(rolled.motion.travel).toBeGreaterThanOrEqual(ranges.travelRange[0] - 1e-9)
        expect(rolled.motion.travel).toBeLessThanOrEqual(ranges.travelRange[1] + 1e-9)
        for (const m of rolled.masses) {
          seen.add(m.motion.path)
          expect(m.motion.travel).toBeGreaterThanOrEqual(ranges.mass.travel[0] - 1e-9)
          expect(m.motion.travel).toBeLessThanOrEqual(ranges.mass.travel[1] + 1e-9)
          expect(m.motion.pulse).toBeLessThanOrEqual(ranges.mass.pulse[1] + 1e-9)
          expect(m.motion.shift).toBeLessThanOrEqual(ranges.mass.shift[1] + 1e-9)
          expect(Math.abs(m.motion.angle)).toBeLessThanOrEqual(180)
        }
      }
    }
    expect([...seen].sort()).toEqual([...MASS_PATHS].sort())
  })

  it('a locked mass keeps its motion', () => {
    const preset = clone(nine[1])
    preset.masses[0].locked = true
    preset.masses[0].motion = { path: 'figure8', travel: 0.5, angle: 10, pulse: 0.2, shift: 5 }
    const rolled = shuffle(preset, draftOf(preset), family, 7, {}, 1)
    expect(rolled.masses[0].motion).toEqual(preset.masses[0].motion)
  })

  it('new backgrounds in Dash at spread 0.8 move differently from Dash and from each other', () => {
    const dash = projects.find((p) => p.id === 'dash')!
    const base = nine.find((p) => p.id === 'dash')!
    const project = { ...dash, spread: 0.8 }
    const sig = (p: { motion: unknown; masses: { motion: unknown }[] }) => JSON.stringify([p.motion, p.masses.map((m) => m.motion)])
    const kids = [11, 22, 33, 44].map((seed, i) => newBackgroundPreset(project, base, `dash-${i + 2}`, seed, family))
    const sigs = new Set(kids.map(sig))
    expect(sigs.size).toBe(kids.length)
    for (const k of kids) expect(sig(k)).not.toBe(sig(base))
    expect(LINK_PATHS).toContain('motion')
  })
})
