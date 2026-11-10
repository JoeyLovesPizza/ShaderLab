import { describe, expect, it } from 'vitest'
import { DEFAULT_ASPECT, packUniforms } from '../../src/model/pack'
import { shuffle } from '../../src/model/shuffle'
import { MAX_MASSES, UNIFORMS, UNIFORM_NAMES, specOf, type UniformValues } from '../../src/shader/massesManifest'
import { draftOf, loadFamily, loadPresets } from '../helpers'

const family = loadFamily()
const presets = loadPresets()

/** Every uniform present, of the right shape, and finite. */
function expectComplete(u: UniformValues, label: string) {
  expect(Object.keys(u).sort()).toEqual([...UNIFORM_NAMES].sort())
  for (const name of UNIFORM_NAMES) {
    const spec = specOf(name)
    const v = u[name]
    expect(v, `${label}: ${name} undefined`).not.toBeUndefined()
    if (spec.kind === 'float' || spec.kind === 'int') {
      expect(typeof v, `${label}: ${name}`).toBe('number')
      expect(Number.isFinite(v), `${label}: ${name} is ${String(v)}`).toBe(true)
    } else {
      expect(Array.isArray(v), `${label}: ${name}`).toBe(true)
      const arr = v as number[]
      const want = spec.kind === 'array' ? spec.count * spec.components : Number(spec.kind.slice(3))
      expect(arr.length, `${label}: ${name} length`).toBe(want)
      for (const n of arr) expect(Number.isFinite(n), `${label}: ${name} holds ${String(n)}`).toBe(true)
    }
  }
}

describe('packUniforms', () => {
  it('the manifest has a default for every name', () => {
    for (const name of UNIFORM_NAMES) expect(UNIFORMS[name].default).toBeDefined()
    expect(MAX_MASSES).toBe(4)
  })

  for (const preset of presets) {
    it(`${preset.id} packs to a complete uniform set`, () => {
      const aspect = preset.canvas.width / preset.canvas.height
      const u = packUniforms(draftOf(preset), family, aspect)
      expectComplete(u, preset.id)
      expect(u.u_massCount).toBe(Math.min(preset.masses.length, MAX_MASSES))
      expect(u.u_baseAlpha).toBe(1)
      expect(u.u_captionMask).toBe(preset.captionMask ? 1 : 0)
      expect(u.u_grain).toBe(preset.texture.grain)
      expect(u.u_grainSeed).toBeGreaterThan(0)
    })
  }

  it('sizes convert to shader (height) units; positions pass through', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    const aspect = preset.canvas.width / preset.canvas.height
    const u = packUniforms(draft, family, aspect)
    const params = u.u_massParams as number[]
    const pos = u.u_massPos as number[]
    const sizes = draft.masses.map((m) => m.size * aspect).sort()
    const packedSizes = draft.masses.map((_, i) => params[4 * i]).sort()
    expect(packedSizes.map((n) => n.toFixed(9))).toEqual(sizes.map((n) => n.toFixed(9)))
    const xs = draft.masses.map((m) => m.x).sort()
    expect(draft.masses.map((_, i) => pos[2 * i]).sort()).toEqual(xs)
    // Darkest first in the uniforms, whatever the file order.
    const labL = draft.masses.map((_, i) => (u.u_massLab as number[])[3 * i])
    expect([...labL].sort((a, b) => a - b)).toEqual(labL)
    // Unused slots are zero, not undefined.
    for (let i = draft.masses.length; i < MAX_MASSES; i++) {
      expect(params.slice(4 * i, 4 * i + 4)).toEqual([0, 0, 0, 0])
      expect((u.u_massOpacity as number[])[i]).toBe(0)
    }
    expect(DEFAULT_ASPECT).toBeCloseTo(613 / 408, 9)
  })

  it('an off depth layer packs as -1, an on one as its amount', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    draft.depth.haze = { on: false, amount: 0.3 }
    draft.depth.curve = { on: true, amount: 0.42 }
    draft.depth.relief = { on: true, amount: 0.2, frequency: 70, twist: 3 }
    const u = packUniforms(draft, family)
    expect(u.u_haze).toBe(-1)
    expect(u.u_curve).toBe(0.42)
    expect(u.u_relief).toBe(0.2)
    expect(u.u_reliefFreq).toBe(70)
    expect(u.u_reliefTwist).toBe(3)
  })

  it('the finish stage follows the family angle when asked', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    draft.finish.motionBlur = { on: true, angle: 90, followAngle: true, length: 0.1, intensity: 0.5 }
    expect(packUniforms(draft, family).u_motionAngle).toBe(family.motion.angle)
    draft.finish.motionBlur.followAngle = false
    expect(packUniforms(draft, family).u_motionAngle).toBe(90)
    expect(packUniforms(draft, family).u_motionOn).toBe(1)
  })

  it('a fifth mass is dropped rather than overflowing the arrays', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    draft.masses = [0, 1, 2, 3, 4].map((i) => ({ ...draft.masses[0], value: 0.2 + i * 0.1 }))
    const u = packUniforms(draft, family)
    expectComplete(u, 'five masses')
    expect(u.u_massCount).toBe(4)
  })

  it('every shuffle over many seeds packs with no NaN', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      for (let seed = 1; seed < 80; seed += 3) {
        const rolled = shuffle(preset, draft, family, seed)
        expectComplete(packUniforms(rolled, family), `${preset.id} seed ${seed}`)
      }
    }
  })

  it('card travel and tempo pack to a finite radius and whole revolutions per loop', () => {
    const draft = draftOf(presets[0])
    for (const travel of [0, 0.3, 0.6, 1]) {
      for (const tempo of [1, 2, 3, 4]) {
        const u = packUniforms({ ...draft, motion: { travel, tempo } }, family)
        expect(Number.isInteger(u.u_speed)).toBe(true)
        expect(Number.isFinite(u.u_driftRadius)).toBe(true)
      }
    }
  })
})
