import { describe, expect, it } from 'vitest'
import { mulberry32, rollModes, rollScoped, shuffle } from '../../src/model/shuffle'
import { COLOUR_MODES, COVERAGE_MODES, L_MAX, L_MIN, STRUCTURE_MODES, type CardDraft, type Preset } from '../../src/model/types'
import { clone, diffPaths, draftOf, loadFamily, loadPresets } from '../helpers'

const family = loadFamily()
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
        const out = shuffle(preset, draft, family, seed)
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
        expect(out.base.chroma, label).toBeLessThanOrEqual(family.base.chromaMax + 1e-9)
        for (const m of out.masses) {
          expect(m.value, label).toBeGreaterThanOrEqual(L_MIN)
          expect(m.value, label).toBeLessThanOrEqual(L_MAX)
          expect(m.chroma, label).toBeGreaterThanOrEqual(0)
          for (const v of Object.values(m)) if (typeof v === 'number') expect(Number.isFinite(v), label).toBe(true)
        }
        // Chroma caps: every mass within the cap, one bold mass excepted.
        const over = out.masses.filter((m) => m.chroma > family.masses.chromaMax + 1e-9)
        expect(over.length, label).toBeLessThanOrEqual(out.modes.bold ? 1 : 0)
        for (const m of over) expect(m.chroma, label).toBeLessThanOrEqual(family.masses.boldMax + 1e-9)
        // At least one dark or low-chroma mass unless coverage is flat.
        if (out.modes.coverage !== 'flat') {
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
        expect(out.seed).toBe(seed)
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
