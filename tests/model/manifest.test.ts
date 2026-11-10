import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildManifest, type ManifestBackground } from '../../src/export/manifest'
import { ROOT } from '../helpers'

const bg = (id: string, project: string): ManifestBackground => ({
  id,
  name: id,
  project,
  file: `/work/shaders/card-${id}.webp`,
  preset: `/shaders/${id}.json`,
  shadowColor: '#808080',
  palette: 'mid base',
})

describe('buildManifest', () => {
  const seed = { readme: 'r', size: { width: 1 } }

  it('lists a project once with its primary first and flags the primary', () => {
    const m = buildManifest(seed, [bg('a-2', 'a'), bg('a-1', 'a'), bg('b', 'b')], [
      { id: 'a', name: 'A', primary: 'a-1' },
      { id: 'b', name: 'B', primary: 'b' },
    ])
    expect(m.projects).toEqual([
      { id: 'a', name: 'A', primary: 'a-1', backgrounds: ['a-1', 'a-2'] },
      { id: 'b', name: 'B', primary: 'b', backgrounds: ['b'] },
    ])
    expect(m.backgrounds.map((b) => [b.id, b.primary])).toEqual([['a-2', false], ['a-1', true], ['b', true]])
  })

  it('falls back to the first exported background when the primary did not export', () => {
    const m = buildManifest(seed, [bg('a-2', 'a')], [{ id: 'a', name: 'A', primary: 'a-1' }])
    expect(m.projects[0].primary).toBe('a-2')
    expect(m.backgrounds[0].primary).toBe(true)
  })

  it('keeps the seed fields and every background field', () => {
    const m = buildManifest(seed, [bg('x', 'x')], [{ id: 'x', name: 'X', primary: 'x' }])
    expect(m.readme).toBe('r')
    expect(m.backgrounds[0]).toMatchObject({ id: 'x', file: '/work/shaders/card-x.webp', shadowColor: '#808080' })
  })
})

describe('handoff/backgrounds.json', () => {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'handoff/backgrounds.json'), 'utf8'))

  it('keeps the id-lookup shape for the nine and makes each its own project', () => {
    expect(m.backgrounds).toHaveLength(9)
    for (const b of m.backgrounds) {
      expect(Object.keys(b)).toEqual(expect.arrayContaining(['id', 'name', 'file', 'preset', 'shadowColor', 'palette', 'project', 'primary']))
      expect(b.primary).toBe(true)
      expect(b.file).toBe(`/work/shaders/card-${b.id}.webp`)
    }
    expect(m.projects).toHaveLength(9)
    for (const p of m.projects) expect(p.backgrounds).toEqual([p.primary])
  })
})
