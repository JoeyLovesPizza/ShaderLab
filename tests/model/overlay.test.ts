import { describe, expect, it } from 'vitest'
import { packUniforms } from '../../src/model/pack'
import { withMassShape } from '../../src/model/types'
import { migrateOverlay } from '../../src/model/validate'
import { clone, draftOf, loadFamily, loadPresets } from '../helpers'

/*
 * An overlay saved by an earlier build (localStorage: a card's draft, a
 * library card) lacks whatever the schema gained since. Each shape the
 * schema has had must migrate, pack with no NaN or undefined, and never
 * throw: Joe's hosted site went down once on exactly this (every card
 * "modified", `reading 'x'`), with the files migrated and the overlays not.
 */

type Obj = Record<string, unknown>
const family = loadFamily()
const presets = loadPresets()

/** The shapes an overlay has been stored in, oldest first. */
const SHAPES: Record<string, (draft: Obj) => void> = {
  'no finish (before the blurs)': (d) => {
    delete d.finish
  },
  'no light or strokes layers (before 2026-11-02)': (d) => {
    const depth = d.depth as Obj
    delete depth.light
    delete depth.strokes
    delete (depth.swirl as Obj).scale
  },
  'missing depth keys': (d) => {
    const depth = d.depth as Obj
    delete depth.haze
    delete depth.relief
    delete depth.shadow
  },
  'masses without kind, path or ramp (before ridges)': (d) => {
    for (const m of d.masses as Obj[]) {
      delete m.kind
      delete m.path
      delete m.ramp
    }
  },
  'quadratic ridge path (before the cubic)': (d) => {
    for (const m of d.masses as Obj[]) {
      const path = m.path as Obj
      delete path.control1
      delete path.control2
      delete (m.ramp as Obj).fieldMix
    }
  },
  'strokes without motion': (d) => {
    delete ((d.depth as Obj).strokes as Obj).motion
  },
  'fibre strokes (length and fibres per height, no chaos, taper, follow or size)': (d) => {
    const strokes = (d.depth as Obj).strokes as Obj
    delete strokes.size
    delete strokes.taper
    delete strokes.chaos
    delete strokes.follow
    strokes.length = 0.7
    strokes.density = 150
  },
  'no photo key (before the Photo stage)': (d) => {
    delete d.photo
  },
  'with a photo': (d) => {
    d.photo = { src: 'photos/daisies.webp', fidelity: 0.5 }
  },
  'everything at once': (d) => {
    delete d.finish
    delete (d.depth as Obj).light
    delete (d.depth as Obj).strokes
    delete (d.depth as Obj).haze
    for (const m of d.masses as Obj[]) {
      delete m.kind
      delete m.path
      delete m.ramp
    }
  },
}

const finite = (v: unknown, path: string) => {
  if (typeof v === 'number') expect(Number.isFinite(v), `${path} is ${v}`).toBe(true)
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`))
  else expect(v, `${path} is ${String(v)}`).toBeDefined()
}

describe('overlays from earlier builds', () => {
  for (const [name, strip] of Object.entries(SHAPES)) {
    it(`${name}: migrates, packs, never throws`, () => {
      for (const preset of presets) {
        const overlay = clone(draftOf(preset)) as unknown as Obj
        strip(overlay)
        ;(overlay as { seed: number }).seed += 1
        const migrated = migrateOverlay(preset, overlay)
        expect(migrated, `${preset.id}: ${name} should migrate`).not.toBeNull()
        const draft = migrated!.draft
        expect(draft.seed).toBe(preset.seed + 1)
        expect(draft.finish.motionBlur).toBeDefined()
        expect(draft.depth.light).toBeDefined()
        expect(draft.depth.strokes.motion).toBeTypeOf('number')
        expect(draft.depth.strokes.chaos).toBeTypeOf('number')
        expect(draft.photo === null || typeof draft.photo.fidelity === 'number').toBe(true)
        expect(draft.depth.strokes.size).toBeTypeOf('number')
        expect(draft.depth.strokes.density).toBeLessThanOrEqual(60)
        for (const m of draft.masses) {
          expect(m.kind === 'blob' || m.kind === 'ridge').toBe(true)
          expect(m.path.control1.x).toBeTypeOf('number')
          expect(m.ramp.fieldMix).toBeTypeOf('number')
        }
        const u = packUniforms(draft, family)
        for (const [key, value] of Object.entries(u)) finite(value, key)
      }
    })
  }

  it('an overlay that cannot be made valid is dropped, not thrown', () => {
    const preset = presets[0]
    expect(migrateOverlay(preset, null)).toBeNull()
    expect(migrateOverlay(preset, 'garbage')).toBeNull()
    expect(migrateOverlay(preset, { masses: [] })).toBeNull()
    expect(migrateOverlay(preset, { base: { hue: 'red' } })).toBeNull()
  })

  it('withMassShape fills a bare mass and keeps a ridge', () => {
    const bare = { hue: 10, value: 0.5, chroma: 0.1, x: 1, y: 0.5, size: 0.4, softness: 0.7, distance: 0.5, locked: false }
    const m = withMassShape(bare as never)
    expect(m.kind).toBe('blob')
    expect(m.path.control1).toEqual({ x: 1, y: 0.5 })
    expect(m.ramp.fieldMix).toBe(0)
    const ridge = withMassShape({ ...bare, kind: 'ridge', path: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } } as never)
    expect(ridge.kind).toBe('ridge')
    expect(ridge.path.control2).toEqual({ x: 1, y: 0.5 })
    const u = packUniforms({ ...draftOf(presets[0]), masses: [bare as never] }, family)
    for (const [key, value] of Object.entries(u)) finite(value, key)
  })
})
