import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CardDraft, Family, Preset, Project } from '../src/model/types'
import { validateFamily, validatePreset, validateProject } from '../src/model/validate'

export const ROOT = resolve(import.meta.dirname, '..')

/** Every preset file the app loads (presets/*.json) plus the examples. */
export function presetFiles(): { file: string; json: unknown }[] {
  const out: { file: string; json: unknown }[] = []
  for (const dir of ['presets', 'presets/examples']) {
    const abs = resolve(ROOT, dir)
    for (const name of readdirSync(abs).filter((n) => n.endsWith('.json') && n !== 'family.json').sort()) {
      out.push({ file: `${dir}/${name}`, json: JSON.parse(readFileSync(resolve(abs, name), 'utf8')) })
    }
  }
  return out
}

export function familyJson(): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, 'presets/family.json'), 'utf8'))
}

export function loadFamily(): Family {
  const result = validateFamily(familyJson())
  if (!result.ok) throw new Error(`family.json invalid: ${JSON.stringify(result.issues)}`)
  return result.value
}

/** The preset files that validate, as presets. */
export function loadPresets(): Preset[] {
  return presetFiles().flatMap(({ json }) => {
    const result = validatePreset(json)
    return result.ok ? [result.value] : []
  })
}

/** The same pick as src/model/cards.ts draftOf, kept here so the tests do
    not import the card store (it touches localStorage at module load). */
export function draftOf(preset: Preset): CardDraft {
  return structuredClone({
    seed: preset.seed,
    modes: preset.modes,
    base: preset.base,
    masses: preset.masses,
    texture: preset.texture,
    depth: preset.depth,
    finish: preset.finish,
    captionMask: preset.captionMask,
    loop: preset.loop,
    photo: preset.photo ?? null,
  })
}

/** Leaf paths where two values differ (same shape as cards.ts diffPaths). */
export function diffPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return []
  const isObjLike = (v: unknown) => typeof v === 'object' && v !== null
  if (!isObjLike(a) || !isObjLike(b)) return [prefix]
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
  const out: string[] = []
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(...diffPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path))
  }
  return out
}

export const clone = <T>(v: T): T => structuredClone(v)

/** The project files, validated. */
export function loadProjects(): Project[] {
  const dir = resolve(ROOT, 'presets/projects')
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((name) => {
      const result = validateProject(JSON.parse(readFileSync(resolve(dir, name), 'utf8')))
      if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.issues)}`)
      return result.value
    })
}
