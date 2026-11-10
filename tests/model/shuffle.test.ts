import { describe, expect, it } from 'vitest'
import { nextBackgroundId, newBackgroundPreset, rerollStyle } from '../../src/model/background'
import { houseRanges } from '../../src/model/house'
import { applyStyleEdit, styleOf, valueAt } from '../../src/model/project'
import { fieldSpan, mulberry32, rollModes, rollScoped, shuffle } from '../../src/model/shuffle'
import { COLOUR_MODES, COVERAGE_MODES, DEPTH_ORDER, L_MAX, L_MIN, LINK_PATHS, STRUCTURE_MODES, type CardDraft, type Family, type Preset, type Project } from '../../src/model/types'
import { validatePreset } from '../../src/model/validate'
import { clone, diffPaths, draftOf, loadFamily, loadPresets, loadProjects } from '../helpers'

const family = loadFamily()
// The family's own ranges bind exactly (house pull 1), for the tests of those bounds.
const tight: Family = { ...family, housePull: 1 }
const presets = loadPresets()
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 13)

/** Hues clustered the way shuffle.ts counts them: within 20° is the same hue. */
function distinctHues(hues: number[]): number {
  const gap = (a: number, b: number) => {
    const d = Math.abs((((a % 360) + 360) % 360) - (((b % 360) + 360) % 360))
    return Math.min(d, 360 - d)
  }
  const out: number[] = []
  for (const h of hues) if (!out.some((o) => gap(o, h) < 20)) out.push(h)
  return out.length
}

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('determinism', () => {
  it('the same seed reproduces the same card, a different seed does not', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      const a = shuffle(preset, draft, family, 123)
      const b = shuffle(preset, clone(draft), family, 123)
      expect(a).toEqual(b)
      expect(rollScoped(preset, draft, family, 123, 'all')).toEqual(rollScoped(preset, clone(draft), family, 123, 'all'))
      expect(shuffle(preset, draft, family, 124)).not.toEqual(a)
    }
  })

  it('never mutates the draft or the origin', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    const before = JSON.stringify({ preset, draft })
    shuffle(preset, draft, family, 5)
    rollScoped(preset, draft, family, 5, 'all', { dirty: new Set(['base.hue']) })
    expect(JSON.stringify({ preset, draft })).toBe(before)
  })

  it('rollModes honours forced choices', () => {
    const modes = rollModes(mulberry32(1), family, { colour: 'triad', coverage: 'flat', structure: 'relief', bold: true })
    expect(modes).toEqual({ colour: 'triad', coverage: 'flat', structure: 'relief', bold: true })
  })
})

describe('locks and dirty fields', () => {
  it('a locked base and a locked mass are untouched by every scope', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      draft.base.locked = true
      draft.masses[0].locked = true
      for (const seed of SEEDS.slice(0, 10)) {
        for (const scope of ['all', 'colour', 'coverage', 'structure'] as const) {
          const out = rollScoped(preset, draft, family, seed, scope)
          expect(out.base).toEqual(draft.base)
          expect(out.masses[0]).toEqual(draft.masses[0])
        }
        expect(shuffle(preset, draft, family, seed).masses[0]).toEqual(draft.masses[0])
      }
    }
  })

  it('a locked mass past the rolled count survives', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    draft.masses = [draft.masses[0], { ...draft.masses[0], locked: true }, { ...draft.masses[0], locked: true }, { ...draft.masses[0], locked: true }]
    for (const seed of SEEDS.slice(0, 20)) {
      const out = rollScoped(preset, draft, family, seed, 'all')
      expect(out.masses.filter((m) => m.locked).length).toBe(3)
    }
  })

  it('dirty paths are never rolled, unless ignoreDirty', () => {
    const preset = presets[0]
    const draft = draftOf(preset)
    const dirty = new Set(['base.value', 'masses.0.hue', 'masses.1.size', 'depth.haze.amount', 'texture.grain'])
    let moved = 0
    for (const seed of SEEDS) {
      const out = rollScoped(preset, draft, family, seed, 'all', { dirty })
      for (const p of diffPaths(draft, out)) expect(dirty.has(p), `${p} rolled although dirty (seed ${seed})`).toBe(false)
      // A mass carrying a hand edit is never dropped by a count change.
      expect(out.masses.length).toBeGreaterThanOrEqual(2)
      const all = rollScoped(preset, draft, family, seed, 'all', { dirty, ignoreDirty: true })
      if (all.base.value !== draft.base.value) moved++
    }
    expect(moved).toBeGreaterThan(0)
  })
})

describe('guardrails', () => {
  const unlocked = (preset: Preset): CardDraft => {
    const d = draftOf(preset)
    d.base.locked = false
    for (const m of d.masses) m.locked = false
    return d
  }

  it('hold for every preset over many seeds', () => {
    for (const preset of presets) {
      const draft = unlocked(preset)
      for (const seed of SEEDS) {
        const out = shuffle(preset, draft, tight, seed)
        const label = `${preset.id} seed ${seed} (${JSON.stringify(out.modes)})`
        expect(COLOUR_MODES).toContain(out.modes.colour)
        expect(COVERAGE_MODES).toContain(out.modes.coverage)
        expect(STRUCTURE_MODES).toContain(out.modes.structure)
        expect(out.masses.length, label).toBeGreaterThanOrEqual(1)
        expect(out.masses.length, label).toBeLessThanOrEqual(4)
        if (out.modes.coverage === 'flat') expect(out.masses.length, label).toBe(1)
        // Tonal rules.
        expect(out.base.value, label).toBeGreaterThanOrEqual(L_MIN)
        expect(out.base.value, label).toBeLessThanOrEqual(L_MAX)
        expect(out.base.chroma, label).toBeLessThanOrEqual(tight.base.chromaMax + 1e-9)
        for (const m of out.masses) {
          expect(m.value, label).toBeGreaterThanOrEqual(L_MIN)
          expect(m.value, label).toBeLessThanOrEqual(L_MAX)
          expect(m.chroma, label).toBeGreaterThanOrEqual(0)
          for (const v of Object.values(m)) if (typeof v === 'number') expect(Number.isFinite(v), label).toBe(true)
        }
        // Chroma caps: every mass within the cap, one bold mass excepted.
        const over = out.masses.filter((m) => m.chroma > tight.masses.chromaMax + 1e-9)
        expect(over.length, label).toBeLessThanOrEqual(out.modes.bold ? 1 : 0)
        for (const m of over) expect(m.chroma, label).toBeLessThanOrEqual(tight.masses.boldMax + 1e-9)
        // At least one dark or low-chroma mass unless coverage is flat, when
        // the origin had one or the colour or coverage was rolled fresh; a
        // style that breaks the rule on purpose keeps doing so.
        const originAnchored = preset.masses.some((m) => m.value <= preset.base.value - 0.15 || m.chroma < 0.05)
        const fresh = originAnchored || out.modes.colour !== preset.modes.colour || out.modes.coverage !== preset.modes.coverage
        if (out.modes.coverage !== 'flat' && fresh) {
          const anchored = out.masses.some((m) => m.value <= out.base.value - 0.15 || m.chroma < 0.05)
          expect(anchored, `${label}: no dark or low-chroma mass`).toBe(true)
        }
        // No more than three hues.
        expect(distinctHues(out.masses.map((m) => m.hue)), label).toBeLessThanOrEqual(3)
        // Only one structure layer on, and it matches the mode.
        expect([out.depth.swirl.on, out.depth.relief.on, out.depth.strokes.on].filter(Boolean).length, label).toBeLessThanOrEqual(1)
        expect(out.depth.swirl.on, label).toBe(out.modes.structure === 'swirl')
        expect(out.depth.relief.on, label).toBe(out.modes.structure === 'relief')
        expect(out.depth.strokes.on, label).toBe(out.modes.structure === 'strokes')
        // The seed passed, or the derived one a lightness re-roll took.
        expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => (seed + i * 7919) % 1_000_000), label).toContain(out.seed)
      }
    }
  })
})

describe('a mode override touches only that mode\'s fields', () => {
  const COLOUR = /^(modes\.(colour|bold)|base\.(hue|chroma)|masses\.\d+\.(hue|chroma))$/
  const COVERAGE = /^(modes\.coverage|masses\.\d+\.(size|softness))$/
  const STRUCTURE = /^(modes\.structure|depth\.(swirl|relief|strokes)\.(on|amount))$/

  it('colour: hues and chroma only, never a value, a position or the seed', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      for (const colour of COLOUR_MODES) {
        const out = rollScoped(preset, draft, family, draft.seed, 'colour', { forced: { ...draft.modes, colour } })
        expect(out.masses.length).toBe(draft.masses.length)
        for (const p of diffPaths(draft, out)) expect(p, `${preset.id} → ${colour} changed ${p}`).toMatch(COLOUR)
      }
    }
  })

  it('coverage: count, size and softness only', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      for (const coverage of COVERAGE_MODES) {
        const out = rollScoped(preset, draft, family, draft.seed, 'coverage', { forced: { ...draft.modes, coverage } })
        for (const p of diffPaths(draft, out)) {
          // A mass added or removed by the count change is new as a whole.
          const m = /^masses\.(\d+)(\.|$)/.exec(p)
          const wholeMass = m && Number(m[1]) >= Math.min(draft.masses.length, out.masses.length)
          if (!wholeMass) expect(p, `${preset.id} → ${coverage} changed ${p}`).toMatch(COVERAGE)
        }
      }
    }
  })

  it('structure: the swirl, relief and strokes layers only', () => {
    for (const preset of presets) {
      const draft = draftOf(preset)
      for (const structure of STRUCTURE_MODES) {
        const out = rollScoped(preset, draft, family, draft.seed, 'structure', { forced: { ...draft.modes, structure } })
        for (const p of diffPaths(draft, out)) expect(p, `${preset.id} → ${structure} changed ${p}`).toMatch(STRUCTURE)
        expect(out.depth.swirl.on).toBe(structure === 'swirl')
        expect(out.depth.relief.on).toBe(structure === 'relief')
        expect(out.depth.strokes.on).toBe(structure === 'strokes')
      }
    }
  })
})

// --- Projects: spread and house pull (SPEC.md §4) -------------------------------

const projects = new Map(loadProjects().map((p) => [p.id, p]))
const nine = presets.filter((p) => projects.has(p.project))
const projectOf = (preset: Preset): Project => projects.get(preset.project)!
const SEEDS40 = SEEDS.slice(0, 40)

/** A preset with a rolled draft over it, as a file would hold it. */
const asPreset = (preset: Preset, draft: CardDraft): Preset => ({ ...preset, ...draft })

const hueGap = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

/** A simple distance over base, masses and depth amounts, each term roughly 0..1. */
function distance(style: Project['style'], draft: CardDraft): number {
  let d = hueGap(style.base.hue, draft.base.hue) / 180 + Math.abs(style.base.value - draft.base.value) + Math.abs(style.base.chroma - draft.base.chroma) * 5
  const n = Math.max(style.masses.length, draft.masses.length)
  for (let i = 0; i < n; i++) {
    const a = style.masses[i]
    const b = draft.masses[i]
    if (!a || !b) {
      d += 2
      continue
    }
    d += hueGap(a.hue, b.hue) / 180 + Math.abs(a.value - b.value) + Math.abs(a.chroma - b.chroma) * 5
    d += Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.size - b.size) + Math.abs(a.softness - b.softness)
  }
  for (const layer of DEPTH_ORDER) {
    const a = style.depth[layer]
    const b = draft.depth[layer]
    d += Number(a.on !== b.on)
    if (layer === 'light') d += Math.abs((a as typeof style.depth.light).height - (b as typeof draft.depth.light).height) / 2
    else d += Math.abs((a as { amount: number }).amount - (b as { amount: number }).amount)
  }
  return d
}

describe('spread', () => {
  it('at 0 the linked stages equal the style; only the seed changes', () => {
    for (const preset of nine) {
      const style = projectOf(preset).style
      const draft = draftOf(preset)
      for (const seed of SEEDS.slice(0, 10)) {
        const out = shuffle(style, draft, family, seed, {}, 0)
        for (const path of LINK_PATHS) expect(valueAt(out, path), `${preset.id} ${path} seed ${seed}`).toEqual(valueAt(style, path))
        expect(out.seed).toBe(seed)
      }
    }
  })

  it('moves the numbers further from the style as it rises', () => {
    const steps = [0, 0.3, 0.6, 1]
    const mean = steps.map((spread) => {
      let total = 0
      let n = 0
      for (const preset of nine) {
        const style = projectOf(preset).style
        const draft = draftOf(preset)
        for (const seed of SEEDS40) {
          total += distance(style, shuffle(style, draft, family, seed, {}, spread))
          n++
        }
      }
      return total / n
    })
    for (let i = 1; i < mean.length; i++) expect(mean[i], `spread ${steps[i]} vs ${steps[i - 1]}: ${mean.join(', ')}`).toBeGreaterThan(mean[i - 1])
  })

  it('the same seed gives the same draft at any spread; a locked mass is untouched', () => {
    for (const preset of nine) {
      const style = projectOf(preset).style
      const draft = draftOf(preset)
      draft.masses[0].locked = true
      for (const spread of [0, 0.5, 1]) {
        const a = shuffle(style, draft, family, 77, {}, spread)
        expect(a).toEqual(shuffle(style, clone(draft), family, 77, {}, spread))
        expect(a.masses[0]).toEqual(draft.masses[0])
      }
    }
  })

  it('a mode forced on the panel wins at spread 0', () => {
    const preset = nine[0]
    const out = shuffle(projectOf(preset).style, draftOf(preset), family, 5, { colour: 'triad' }, 0)
    expect(out.modes.colour).toBe('triad')
  })
})

describe('house pull', () => {
  it('at 1 the ranges and flags are the family\'s', () => {
    expect(houseRanges(tight)).toEqual(tight)
  })

  it('at 0 every range reaches its legal limit', () => {
    const wide = houseRanges({ ...family, housePull: 0 })
    expect(wide.base.value).toEqual([L_MIN, L_MAX])
    expect(wide.masses.count).toEqual([1, 4])
    expect(wide.masses.size).toEqual([0.05, 4])
    expect(wide.masses.softness).toEqual([0, 1])
    expect(wide.depth.haze.amount).toEqual([0, 1])
    expect(wide.depth.light.amount).toEqual([0, 2])
  })

  it('at 1 every roll stays inside the family ranges and uses only allowed layers', () => {
    for (const preset of nine) {
      const style = projectOf(preset).style
      const draft = draftOf(preset)
      draft.depth.shadow.on = false
      for (const seed of SEEDS40) {
        const out = shuffle(style, draft, tight, seed, {}, 1)
        const label = `${preset.id} seed ${seed}`
        expect(out.base.value, label).toBeGreaterThanOrEqual(tight.base.value[0])
        expect(out.base.value, label).toBeLessThanOrEqual(tight.base.value[1])
        expect(out.base.chroma, label).toBeLessThanOrEqual(tight.base.chromaMax + 1e-9)
        for (const m of out.masses) expect(m.chroma, label).toBeLessThanOrEqual(tight.masses.boldMax + 1e-9)
        for (const layer of DEPTH_ORDER) {
          const rule = tight.depth[layer]
          const now = out.depth[layer]
          if (!rule.allowed) expect(now.on, `${label} ${layer}`).toBe(false)
          const amount = layer === 'light' ? (now as typeof out.depth.light).height : (now as { amount: number }).amount
          expect(amount, `${label} ${layer}`).toBeGreaterThanOrEqual(rule.amount[0] - 1e-9)
          expect(amount, `${label} ${layer}`).toBeLessThanOrEqual(rule.amount[1] + 1e-9)
        }
        expect(out.texture.grain, label).toBeGreaterThanOrEqual(tight.texture.range[0] - 1e-9)
        expect(out.texture.grain, label).toBeLessThanOrEqual(tight.texture.range[1] + 1e-9)
      }
    }
  })

  it('at 0 some roll leaves a family range or switches on a disallowed layer, and every roll validates', () => {
    const loose: Family = { ...family, housePull: 0 }
    let outside = 0
    let disallowedOn = 0
    for (const preset of nine) {
      const style = projectOf(preset).style
      const draft = draftOf(preset)
      for (const seed of SEEDS40) {
        const out = shuffle(style, draft, loose, seed, {}, 1)
        const result = validatePreset(JSON.parse(JSON.stringify(asPreset(preset, out))))
        expect(result.ok, `${preset.id} seed ${seed}: ${result.ok ? '' : JSON.stringify(result.issues)}`).toBe(true)
        if (out.depth.shadow.on) disallowedOn++
        if (
          out.base.value < family.base.value[0] ||
          out.base.value > family.base.value[1] ||
          out.base.chroma > family.base.chromaMax + 1e-9 ||
          out.masses.some((m) => m.chroma > family.masses.boldMax + 1e-9 || m.size > family.masses.size[1])
        ) {
          outside++
        }
      }
    }
    expect(outside).toBeGreaterThan(0)
    expect(disallowedOn).toBeGreaterThan(0)
  })

  it('every roll validates at every pull and spread', () => {
    for (const preset of nine.slice(0, 4)) {
      const style = projectOf(preset).style
      const draft = draftOf(preset)
      for (const housePull of [0, 0.5, 1]) {
        for (const spread of [0, 0.5, 1]) {
          for (const seed of SEEDS.slice(0, 15)) {
            const out = shuffle(style, draft, { ...family, housePull }, seed, {}, spread)
            const result = validatePreset(JSON.parse(JSON.stringify(asPreset(preset, out))))
            expect(result.ok, `${preset.id} pull ${housePull} spread ${spread} seed ${seed}: ${result.ok ? '' : JSON.stringify(result.issues)}`).toBe(true)
          }
        }
      }
    }
  })
})

describe('new background and shuffle project', () => {
  const daisies = nine.find((p) => p.id === 'daisies') ?? nine[0]
  const project = projectOf(daisies)

  it('numbers ids <project>-<n> from 2, first free', () => {
    expect(nextBackgroundId('daisies', ['daisies'])).toBe('daisies-2')
    expect(nextBackgroundId('daisies', ['daisies', 'daisies-2', 'daisies-4'])).toBe('daisies-3')
    expect(nextBackgroundId('daisies', ['daisies-2', 'daisies-3'])).toBe('daisies-4')
  })

  it('is one shuffle from the style at the project spread, with a new seed, and validates', () => {
    const a = newBackgroundPreset(project, daisies, 'daisies-2', 4242, family)
    expect(a).toEqual(newBackgroundPreset(project, clone(daisies), 'daisies-2', 4242, family))
    expect(a.id).toBe('daisies-2')
    expect(a.project).toBe(project.id)
    expect(a.seed).toBe(4242)
    expect(a.masses.every((m) => !m.locked)).toBe(true)
    expect(validatePreset(JSON.parse(JSON.stringify(a))).ok).toBe(true)
    // It follows its project: a variation seed, nothing overridden.
    expect(a.variation).toBe(4242)
    expect(a.overrides).toEqual([])
    // At spread 0 it is the style.
    const still = newBackgroundPreset({ ...project, spread: 0 }, daisies, 'daisies-2', 9, family)
    expect(still.overrides).toEqual([])
    expect(styleOf(still)).toEqual(project.style)
  })

  it('shuffleProject re-rolls the style; linked backgrounds follow and overridden ones stay', () => {
    const linked: Preset = { ...clone(daisies), id: 'linked', overrides: [] }
    const own: Preset = { ...clone(daisies), id: 'own', overrides: ['base'] }
    own.base = { ...own.base, hue: (own.base.hue + 100) % 360 }
    const style = rerollStyle(daisies, family, 31)
    expect(style).toEqual(rerollStyle(daisies, family, 31))
    expect(style).not.toEqual(project.style)
    const { project: next, backgrounds } = applyStyleEdit(project, style, [linked, own])
    expect(next.style).toEqual(style)
    const [l, o] = backgrounds
    for (const path of LINK_PATHS) expect(valueAt(l, path), path).toEqual(valueAt(style, path))
    expect(o.base).toEqual(own.base)
    expect(o.masses).toEqual(style.masses)
  })
})

const unlockedDraft = (preset: Preset): CardDraft => {
  const d = draftOf(preset)
  d.base.locked = false
  for (const m of d.masses) m.locked = false
  return d
}

describe('project styles survive a low spread', () => {
  const family = loadFamily()
  const paper = loadPresets().find((p) => p.id === 'paper')!

  it('keeps Paper\'s blue at spread 0.15', () => {
    const blue = paper.masses[0]
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const out = shuffle(paper, unlockedDraft(paper), family, seed, {}, 0.15)
      if (out.modes.colour !== paper.modes.colour) continue
      expect(out.masses[0].chroma, `seed ${seed}`).toBeGreaterThan(blue.chroma * 0.6)
    }
  })
})

describe('the lightness span', () => {
  const family = loadFamily()
  const presets = loadPresets()

  it('never rolls a blank card from a style that has range', () => {
    for (const preset of presets) {
      const own = fieldSpan(preset)
      for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
        const out = shuffle(preset, unlockedDraft(preset), family, seed, {}, 0.85)
        // The blank cards this guards against measured near 0; the estimate is
        // coarse, so the bar is well under the rule rather than on it.
        expect(fieldSpan(out), `${preset.id} seed ${seed}`).toBeGreaterThan(Math.min(0.2, 0.5 * own))
      }
    }
  })
})

