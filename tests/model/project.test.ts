import { describe, expect, it } from 'vitest'
import {
  applyStyleEdit,
  overridesAfterEdit,
  projectFromPreset,
  relink,
  resolveBackground,
} from '../../src/model/project'
import { LINK_PATHS, type LinkPath, type Preset, type Project, type ProjectStyle } from '../../src/model/types'
import { validatePreset, validateProject } from '../../src/model/validate'
import { clone, draftOf, loadPresets, loadProjects } from '../helpers'

// presets/examples is not loaded by the app and has no project file.
const presets = loadPresets().filter((p) => p.id !== 'placeholder')
const daisies = presets.find((p) => p.id === 'daisies')!
const dash = presets.find((p) => p.id === 'dash')!

/** A project from one card, with a different look in the stages the tests move. */
function movedStyle(style: ProjectStyle): ProjectStyle {
  const next = clone(style)
  next.base.hue = (next.base.hue + 90) % 360
  next.texture.grain = 0.2
  next.depth.haze.amount = 0.77
  next.depth.curve.on = !next.depth.curve.on
  next.masses[0].size = 0.9
  return next
}

describe('LINK_PATHS', () => {
  it('lists the four stages and every depth layer', () => {
    expect(LINK_PATHS).toEqual(expect.arrayContaining(['base', 'masses', 'texture', 'modes', 'depth.light', 'depth.shadow', 'depth.strokes']))
    expect(LINK_PATHS).toHaveLength(12)
  })
})

describe('the files', () => {
  it('every preset has a project file, and every project primary is a background of it', () => {
    const projects = new Map(loadProjects().map((p) => [p.id, p]))
    for (const preset of presets) {
      expect(projects.has(preset.project), `${preset.id} → ${preset.project}`).toBe(true)
      expect(preset.overrides).toEqual([])
    }
    for (const project of projects.values()) {
      expect(presets.find((p) => p.id === project.primary)?.project).toBe(project.id)
    }
  })

  it('resolving each card against its own project changes nothing', () => {
    const projects = new Map(loadProjects().map((p) => [p.id, p]))
    for (const preset of presets) {
      expect(resolveBackground(preset, projects.get(preset.project)!)).toEqual(preset)
    }
  })
})

describe('resolveBackground', () => {
  const project = projectFromPreset(daisies)
  project.style = movedStyle(project.style)

  it('a linked path follows the project', () => {
    const out = resolveBackground(daisies, project)
    expect(out.base).toEqual(project.style.base)
    expect(out.texture).toEqual(project.style.texture)
    expect(out.depth.haze).toEqual(project.style.depth.haze)
    expect(out.masses).toEqual(project.style.masses)
  })

  it('an overridden path keeps its own', () => {
    const own: Preset = { ...daisies, overrides: ['base', 'depth.haze'] }
    const out = resolveBackground(own, project)
    expect(out.base).toEqual(daisies.base)
    expect(out.depth.haze).toEqual(daisies.depth.haze)
    expect(out.texture).toEqual(project.style.texture)
    expect(out.depth.curve).toEqual(project.style.depth.curve)
  })

  it('never touches photo, seed, loop, states, canvas, finish, captionMask, id or meta', () => {
    const own: Preset = { ...clone(daisies), seed: 5, captionMask: true }
    const out = resolveBackground(own, project)
    for (const key of ['photo', 'seed', 'loop', 'states', 'canvas', 'finish', 'captionMask', 'id', 'meta', 'project', 'overrides', 'image'] as const) {
      expect(out[key], key).toEqual(own[key])
    }
  })

  it('returns a deep copy: the project is not aliased', () => {
    const out = resolveBackground(daisies, project)
    out.masses[0].hue = 1
    out.depth.haze.amount = 0.01
    expect(project.style.masses[0].hue).not.toBe(1)
    expect(project.style.depth.haze.amount).toBe(0.77)
  })

  it('stays a valid preset', () => {
    expect(validatePreset(resolveBackground(daisies, project)).ok).toBe(true)
  })
})

describe('overridesAfterEdit', () => {
  it('marks only the LinkPaths that changed', () => {
    const prev = draftOf(daisies)
    const next = clone(prev)
    next.base.hue += 10
    next.depth.haze.amount += 0.05
    next.seed += 1
    next.finish.layerBlur.on = !next.finish.layerBlur.on
    expect(overridesAfterEdit(prev, next, [])).toEqual(['base', 'depth.haze'])
  })

  it('keeps the overrides it already had, and adds in LINK_PATHS order', () => {
    const prev = draftOf(daisies)
    const next = clone(prev)
    next.texture.grain += 0.01
    const out = overridesAfterEdit(prev, next, ['depth.light'])
    expect(out).toEqual(['texture', 'depth.light'])
  })

  it('an unchanged draft adds nothing', () => {
    const prev = draftOf(daisies)
    expect(overridesAfterEdit(prev, clone(prev), [])).toEqual([])
  })
})

describe('relink', () => {
  it('drops the override and takes the project value', () => {
    const project = projectFromPreset(daisies)
    const own: Preset = { ...clone(daisies), overrides: ['base', 'texture'], base: { ...daisies.base, hue: 12 }, texture: { grain: 0.3 } }
    const out = relink(own, project, 'base')
    expect(out.overrides).toEqual(['texture'])
    expect(out.base).toEqual(project.style.base)
    expect(out.texture).toEqual({ grain: 0.3 })
  })
})

describe('applyStyleEdit', () => {
  it('moves linked backgrounds and leaves overridden ones', () => {
    const project: Project = projectFromPreset(daisies)
    const linked: Preset = { ...clone(daisies), id: 'a', project: project.id }
    const own: Preset = { ...clone(daisies), id: 'b', project: project.id, overrides: ['base'] as LinkPath[], base: { ...daisies.base, hue: 12 } }
    const stranger: Preset = { ...clone(dash), project: 'dash' }
    const next = movedStyle(project.style)
    const out = applyStyleEdit(project, next, [linked, own, stranger])
    expect(out.project.style).toEqual(next)
    expect(out.backgrounds[0].base).toEqual(next.base)
    expect(out.backgrounds[0].texture).toEqual(next.texture)
    expect(out.backgrounds[1].base.hue).toBe(12)
    expect(out.backgrounds[1].texture).toEqual(next.texture)
    expect(out.backgrounds[2]).toEqual(stranger)
    expect(project.style.base).toEqual(daisies.base)
  })
})

describe('migration', () => {
  it('a preset with no project becomes its own, with a warning', () => {
    const raw = clone(daisies) as unknown as Record<string, unknown>
    delete raw.project
    delete raw.overrides
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.project).toBe('daisies')
    expect(result.value.overrides).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('unknown override paths are dropped with a warning', () => {
    const raw = { ...clone(daisies), overrides: ['base', 'depth.nope', 'finish', 'base', 'depth.haze'] }
    const result = validatePreset(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.overrides).toEqual(['base', 'depth.haze'])
    expect(result.warnings.filter((w) => w.path === 'overrides')).toHaveLength(2)
  })
})

describe('validateProject', () => {
  it('accepts a project made from a card, and reads a missing spread as 0.4', () => {
    const raw = clone(projectFromPreset(daisies)) as unknown as Record<string, unknown>
    expect(validateProject(raw).ok).toBe(true)
    delete raw.spread
    const result = validateProject(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.spread).toBe(0.4)
  })

  it('reports issues on a bad file and never throws', () => {
    const good = clone(projectFromPreset(daisies)) as unknown as Record<string, any>
    const bad: unknown[] = [
      null,
      'nope',
      [],
      {},
      { ...good, schema: 1 },
      { ...good, id: 'Bad Id' },
      { ...good, spread: 3 },
      { ...good, primary: '' },
      { ...good, style: null },
      { ...good, style: { ...good.style, masses: [] } },
      { ...good, style: { ...good.style, base: { hue: 'red' } } },
      { ...good, style: { ...good.style, depth: 7 } },
      { ...good, meta: {} },
    ]
    for (const raw of bad) {
      const result = validateProject(raw)
      expect(result.ok, JSON.stringify(raw)?.slice(0, 60)).toBe(false)
      if (!result.ok) expect(result.issues.length).toBeGreaterThan(0)
    }
  })
})
