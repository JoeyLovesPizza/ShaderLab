import { describe, expect, it } from 'vitest'
import { newBackgroundPreset } from '../../src/model/background'
import { deriveBackground, deriveLinked, shuffleVariation } from '../../src/model/derive'
import { overridesAfterEdit, projectFromPreset, resolveBackground, styleOf, valueAt } from '../../src/model/project'
import { LINK_PATHS, type CardDraft, type LinkPath, type Preset, type Project } from '../../src/model/types'
import { validatePreset } from '../../src/model/validate'
import { serializePreset } from '../../src/export/preset'
import { clone, draftOf, loadFamily, loadPresets, loadProjects } from '../helpers'

const family = loadFamily()
const nine = loadPresets().filter((p) => p.id !== 'placeholder')
const daisies = nine.find((p) => p.id === 'daisies')!
const project0: Project = loadProjects().find((p) => p.id === 'daisies')!

const withSpread = (p: Project, spread: number): Project => ({ ...p, spread })
const json = (v: unknown) => JSON.stringify(v)
const linkedOf = (a: Preset, b: Preset) => LINK_PATHS.map((path) => json(valueAt(a, path)) === json(valueAt(b, path)))

/** Sum over every linked numeric leaf of how far `a` is from `b`, as a rough distance. */
function distance(a: Preset | CardDraft, b: Preset | CardDraft): number {
  const walk = (x: unknown, y: unknown): number => {
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y)
    if (typeof x === 'boolean' || typeof x === 'string') return x === y ? 0 : 1
    if (Array.isArray(x) && Array.isArray(y)) {
      let d = Math.abs(x.length - y.length)
      for (let i = 0; i < Math.min(x.length, y.length); i++) d += walk(x[i], y[i])
      return d
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      let d = 0
      for (const k of Object.keys(x)) if (k !== 'locked' && k !== 'path' && k !== 'ramp') d += walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])
      return d
    }
    return x === y ? 0 : 1
  }
  return LINK_PATHS.reduce((sum, path) => sum + walk(valueAt(a, path), valueAt(b, path)), 0)
}

// The project argument is only for the reader: a sibling is a copy of a card with a seed.
const sibling = (_project: Project, seed: number, overrides: LinkPath[] = []): Preset => ({
  ...clone(daisies),
  id: `s${seed}`,
  overrides,
  variation: seed,
})

describe('deriveLinked', () => {
  it('variation null equals the style (resolveBackground)', () => {
    for (const p of nine) {
      const project = loadProjects().find((x) => x.id === p.project)!
      expect(deriveBackground({ ...p, variation: null }, project, family)).toEqual(resolveBackground(p, project))
    }
  })

  it('spread 0 gives the style back, whatever the seed', () => {
    const project = withSpread(project0, 0)
    for (const seed of [1, 77, 4242]) {
      const out = deriveBackground(sibling(project, seed), project, family)
      expect(styleOf(out)).toEqual(project.style)
    }
  })

  it('is deterministic: the same style, spread, family and seed give identical values', () => {
    const project = withSpread(project0, 0.6)
    const a = deriveBackground(sibling(project, 9001), project, family)
    const b = deriveBackground(sibling(project, 9001), clone(project), clone(family))
    expect(a).toEqual(b)
    expect(styleOf(deriveBackground(sibling(project, 9002), project, family))).not.toEqual(styleOf(a))
  })

  it('does not read the background\'s own stages or locks', () => {
    const project = withSpread(project0, 0.6)
    const plain = deriveBackground(sibling(project, 31, ['base']), project, family)
    const edited = sibling(project, 31, ['base'])
    edited.base = { ...edited.base, hue: 5, locked: true }
    edited.masses = edited.masses.map((m) => ({ ...m, locked: true }))
    const out = deriveBackground(edited, project, family)
    expect(out.base).toEqual(edited.base)
    for (const path of LINK_PATHS.filter((p) => p !== 'base')) expect(valueAt(out, path), path).toEqual(valueAt(plain, path))
  })

  it('a hand-edited stage is not re-derived; a style edit moves the rest', () => {
    const project = withSpread(project0, 0.5)
    const bg = sibling(project, 55, ['texture'])
    bg.texture = { grain: 0.123 }
    const before = deriveBackground(bg, project, family)
    expect(before.texture).toEqual({ grain: 0.123 })
    const moved: Project = { ...project, style: clone(project.style) }
    moved.style.base.hue = (moved.style.base.hue + 120) % 360
    moved.style.texture.grain = 0.4
    const after = deriveBackground(before, moved, family)
    expect(after.texture).toEqual({ grain: 0.123 })
    expect(after.base.hue).not.toBe(before.base.hue)
  })

  it('a style edit moves siblings, and they stay different from each other at spread > 0', () => {
    const project = withSpread(project0, 0.5)
    const moved: Project = { ...project, style: clone(project.style) }
    moved.style.base.hue = (moved.style.base.hue + 90) % 360
    moved.style.masses[0].hue = (moved.style.masses[0].hue + 90) % 360
    const seeds = [3, 14, 159]
    const before = seeds.map((s) => deriveBackground(sibling(project, s), project, family))
    const after = seeds.map((s) => deriveBackground(sibling(project, s), moved, family))
    for (let i = 0; i < seeds.length; i++) expect(json(styleOf(after[i]))).not.toBe(json(styleOf(before[i])))
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) expect(json(styleOf(after[i]))).not.toBe(json(styleOf(after[j])))
    }
  })

  it('raising spread moves siblings away from the style on average, and restoring it returns them exactly', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => i * 101 + 7)
    const mean = (spread: number) => {
      const project = withSpread(project0, spread)
      return seeds.reduce((sum, s) => sum + distance(deriveBackground(sibling(project, s), project, family), project.style as never), 0) / seeds.length
    }
    const low = mean(0.1)
    const mid = mean(0.5)
    const high = mean(0.9)
    expect(mean(0)).toBe(0)
    expect(mid).toBeGreaterThan(low)
    expect(high).toBeGreaterThan(mid)
    // Same seed, same spread: the same background, however it got there.
    const at = (spread: number) => deriveBackground(sibling(withSpread(project0, spread), 7), withSpread(project0, spread), family)
    const first = at(0.3)
    at(0.9)
    expect(at(0.3)).toEqual(first)
  })

  it('a changed house pull re-derives, and the same pull reproduces', () => {
    const project = withSpread(project0, 0.7)
    const a = deriveBackground(sibling(project, 21), project, { ...family, housePull: 0 })
    const b = deriveBackground(sibling(project, 21), project, { ...family, housePull: 1 })
    expect(json(styleOf(a))).not.toBe(json(styleOf(b)))
    expect(deriveBackground(sibling(project, 21), project, { ...family, housePull: 0 })).toEqual(a)
  })

  it('stays stable through serialize, validate and derive', () => {
    const project = withSpread(project0, 0.6)
    const bg = sibling(project, 808, ['depth.haze'])
    bg.depth = { ...bg.depth, haze: { on: true, amount: 0.33333333 } }
    const derived = deriveBackground(bg, project, family)
    const round = validatePreset(JSON.parse(serializePreset(derived)))
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.value.variation).toBe(808)
    // Linked stages derive again from the style alone: identical to the first time.
    const again = deriveBackground(round.value, project, family)
    for (const path of LINK_PATHS.filter((p) => p !== 'depth.haze')) expect(valueAt(again, path), path).toEqual(valueAt(derived, path))
    expect(again.depth.haze.on).toBe(true)
  })
})

describe('new background and shuffle', () => {
  const project = withSpread(project0, 0.5)

  it('a new background has a seed, no overrides, and equals its own derivation', () => {
    const a = newBackgroundPreset(project, daisies, 'daisies-2', 4242, family)
    expect(a.variation).toBe(4242)
    expect(a.overrides).toEqual([])
    expect(deriveBackground(a, project, family)).toEqual(a)
    expect(validatePreset(JSON.parse(serializePreset(a))).ok).toBe(true)
    // Siblings with different seeds differ.
    const b = newBackgroundPreset(project, daisies, 'daisies-3', 17, family)
    expect(json(styleOf(a))).not.toBe(json(styleOf(b)))
  })

  it('shuffle gives a new seed and adds no overrides; owned stages are left alone', () => {
    const own: LinkPath[] = ['base', 'depth.curve']
    const draft = draftOf(sibling(project, 5, own))
    draft.base.hue = 17.5
    const shuffled = shuffleVariation(draft, own, 6001, project, family)
    expect(shuffled.base).toEqual(draft.base)
    expect(shuffled.depth.curve).toEqual(draft.depth.curve)
    // The stages it did not own moved, and nothing new would be marked by comparing against the derivation.
    expect(json(styleOf(shuffled))).not.toBe(json(styleOf(draft)))
    expect(shuffled).toEqual({ ...deriveLinked(shuffled, own, 6001, project, family) })
    // Each linked stage equals the derivation at the new seed.
    const viaPreset = deriveBackground({ ...sibling(project, 6001, own), base: draft.base, depth: { ...sibling(project, 6001).depth, curve: draft.depth.curve } }, project, family)
    for (const path of LINK_PATHS) expect(valueAt(shuffled, path), path).toEqual(valueAt(viaPreset, path))
    expect(linkedOf(shuffled as never, draft as never)).toContain(false)
  })

  it('a hand edit becomes an override and stops being derived', () => {
    const bg = deriveBackground(sibling(project, 12), project, family)
    const edited = clone(bg)
    edited.texture = { grain: bg.texture.grain + 0.05 }
    const own = overridesAfterEdit(bg, edited, [])
    expect(own).toEqual(['texture'])
    const moved: Project = { ...project, style: { ...clone(project.style), texture: { grain: 0.5 } } }
    expect(deriveLinked(edited, own, 12, moved, family).texture).toEqual(edited.texture)
  })
})

describe('the nine presets', () => {
  it('load with variation null, and their derivation equals their files', () => {
    const projects = loadProjects()
    for (const p of nine) {
      expect(p.variation, p.id).toBeNull()
      const project = projects.find((x) => x.id === p.project) ?? projectFromPreset(p)
      const out = deriveBackground(p, project, family)
      expect(out, p.id).toEqual(resolveBackground(p, project))
      // No overrides on a migrated card: its linked stages are the file's.
      if (p.overrides.length === 0) expect(styleOf(out), p.id).toEqual(styleOf(p))
    }
  })
})
