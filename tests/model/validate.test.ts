import { describe, expect, it } from 'vitest'
import { validateFamily, validatePreset } from '../../src/model/validate'
import { DEPTH_ORDER } from '../../src/model/types'
import { clone, familyJson, loadFamily, presetFiles } from '../helpers'

type Obj = Record<string, any>

const files = presetFiles()
const good = () => clone(files[0].json) as Obj

describe('preset files', () => {
  it('finds preset files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const { file, json } of files) {
    it(`${file} validates and its id matches the filename`, () => {
      const result = validatePreset(json)
      if (!result.ok) throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '))
      expect(result.value.id).toBe(file.replace(/^.*\//, '').replace(/\.json$/, ''))
      // Migration warnings are allowed, but a tracked file should be current.
      expect(result.warnings, `${file} needs migrating: ${JSON.stringify(result.warnings)}`).toEqual([])
    })
  }

  it('presets/family.json validates', () => {
    const result = validateFamily(familyJson())
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.value.meta.version).toBeTypeOf('number')
  })
})

describe('migration (older files load with warnings, never as invalid)', () => {
  it('a removed structure value becomes "none" with a warning', () => {
    const raw = good()
    raw.modes.structure = 'grid'
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.modes.structure).toBe('none')
    expect(result.warnings.some((w) => w.path === 'modes.structure')).toBe(true)
  })

  it('a stray depth key is dropped with a warning', () => {
    const raw = good()
    raw.depth.grid = { on: true, amount: 0.5 }
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('grid' in result.value.depth).toBe(false)
    expect(result.warnings.some((w) => w.path === 'depth.grid')).toBe(true)
  })

  it('a missing depth layer fills in as off, with a warning', () => {
    for (const layer of DEPTH_ORDER) {
      const raw = good()
      delete raw.depth[layer]
      const result = validatePreset(raw)
      expect(result.ok, `missing depth.${layer} should still load`).toBe(true)
      if (!result.ok) continue
      expect(result.value.depth[layer].on).toBe(false)
      expect(result.warnings.some((w) => w.path === `depth.${layer}`)).toBe(true)
    }
  })

  it('a missing finish stage fills from the defaults and sits within the family ranges', () => {
    const raw = good()
    delete raw.finish
    const family = loadFamily()
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const f = result.value.finish
    expect(f.motionBlur.on).toBe(false)
    expect(f.layerBlur.on).toBe(false)
    expect(f.motionBlur.length).toBeGreaterThanOrEqual(family.finish.motionBlur.length[0])
    expect(f.motionBlur.length).toBeLessThanOrEqual(family.finish.motionBlur.length[1])
    expect(f.layerBlur.radius).toBeGreaterThanOrEqual(family.finish.layerBlur.radius[0])
    expect(f.layerBlur.radius).toBeLessThanOrEqual(family.finish.layerBlur.radius[1])
    for (const v of [...Object.values(f.motionBlur), ...Object.values(f.layerBlur)]) {
      expect(v).not.toBeUndefined()
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('a partial finish keeps what the file has and fills the rest', () => {
    const raw = good()
    raw.finish = { layerBlur: { on: true, radius: 0.1, intensity: 0.5 } }
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.finish.layerBlur.radius).toBe(0.1)
    expect(result.value.finish.motionBlur.followAngle).toBe(true)
  })

  it('never mutates its input', () => {
    const raw = good()
    raw.modes.structure = 'grid'
    delete raw.depth.swirl
    const before = JSON.stringify(raw)
    validatePreset(raw)
    expect(JSON.stringify(raw)).toBe(before)
  })
})

describe('rules', () => {
  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}, { modes: 'no', depth: 7, masses: 'nope', finish: 3, states: 1 }]) {
      expect(() => validatePreset(raw)).not.toThrow()
      expect(validatePreset(raw).ok).toBe(false)
      expect(() => validateFamily(raw)).not.toThrow()
    }
  })

  it('rejects zero or five masses', () => {
    const none = good()
    none.masses = []
    expect(validatePreset(none).ok).toBe(false)
    const five = good()
    five.masses = [...five.masses, ...five.masses, ...five.masses].slice(0, 5)
    expect(validatePreset(five).ok).toBe(false)
  })

  it('rejects swirl and relief both on', () => {
    const raw = good()
    raw.depth.swirl.on = true
    raw.depth.relief.on = true
    const result = validatePreset(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.path === 'depth')).toBe(true)
  })

  it('rejects values outside the tonal rules', () => {
    const raw = good()
    raw.masses[0].value = 0.05
    expect(validatePreset(raw).ok).toBe(false)
    const high = good()
    high.base.value = 0.99
    expect(validatePreset(high).ok).toBe(false)
  })

  it('rejects a stillTime past the loop and a data: image', () => {
    const raw = good()
    raw.loop.stillTime = raw.loop.seconds + 1
    expect(validatePreset(raw).ok).toBe(false)
    const img = good()
    img.image = { src: 'data:image/png;base64,AAAA', fidelity: 0.3, rampSource: 'extracted' }
    expect(validatePreset(img).ok).toBe(false)
  })

  it('rejects a state that moves anything but exposure and contrast', () => {
    const raw = good()
    raw.states.hover.uniforms.u_massPos = [0, 0]
    expect(validatePreset(raw).ok).toBe(false)
  })

  it('family: a non-integer tempo and a missing finish fail', () => {
    const fam = clone(familyJson()) as Obj
    fam.motion.tempo = 1.5
    expect(validateFamily(fam).ok).toBe(false)
    const noFinish = clone(familyJson()) as Obj
    delete noFinish.finish
    expect(validateFamily(noFinish).ok).toBe(false)
  })

  it('family: a v9 motion block (amount, speed, driftRange) becomes the house default and ranges', () => {
    const fam = clone(familyJson()) as Obj
    fam.motion = { amount: 0.6, angle: 20, driftRadius: 0.1, driftRange: [0.03, 0.2], speed: 2 }
    const result = validateFamily(fam)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.motion.travel).toBe(0.6)
    expect(result.value.motion.tempo).toBe(2)
    expect(result.value.motion.mass.paths).toEqual(['circle', 'ellipse', 'line', 'figure8'])
    expect((result.value.motion as unknown as Obj).amount).toBeUndefined()
  })

  it('a card tempo that is not whole, or a mass path that does not exist, fails', () => {
    const raw = good()
    raw.motion = { travel: 0.6, tempo: 2.5 }
    expect(validatePreset(raw).ok).toBe(false)
    const bad = good()
    bad.masses[0].motion = { path: 'spiral', travel: 1, angle: 0, pulse: 0, shift: 0 }
    expect(validatePreset(bad).ok).toBe(false)
    const far = good()
    far.masses[0].motion = { path: 'line', travel: 1, angle: 0, pulse: 0.5, shift: 0 }
    expect(validatePreset(far).ok).toBe(false)
  })
})
