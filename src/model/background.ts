import { shuffleVariation } from './derive'
import { followStyle, styleOf } from './project'
import { mulberry32, rollScoped } from './shuffle'
import { blobMass, type CardDraft, type Family, type Preset, type Project, type ProjectStyle } from './types'

/*
 * Pure halves of "New background" and "Shuffle project" (SPEC.md §4), so
 * the tests run them in node; the stores that call them are library.ts
 * and projects.ts.
 */

/** `<project>-<n>`, the first n ≥ 2 that is not taken. */
export function nextBackgroundId(projectId: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let n = 2
  while (used.has(`${projectId}-${n}`)) n++
  return `${projectId}-${n}`
}

/**
 * A card from the family defaults, in `blank`'s shape: the starting point
 * of a New card and of a project re-rolled from the house.
 */
export function familyTemplate(blank: Preset, family: Family, hue: number, seed: number): Preset {
  const template = structuredClone(blank)
  template.seed = seed
  template.base = { hue, value: (family.base.value[0] + family.base.value[1]) / 2, chroma: 0.03, locked: false }
  template.masses = [
    blobMass({ hue, value: 0.8, chroma: 0.1, x: 1.15, y: 0.85, size: 0.45, softness: 0.8, distance: 0.5, locked: false }),
    blobMass({ hue, value: 0.3, chroma: 0.05, x: 0.3, y: 0.2, size: 0.4, softness: 0.85, distance: 0.8, locked: false }),
  ]
  template.texture.grain = family.texture.grain
  for (const layer of ['curve', 'parallax', 'haze', 'swirl', 'relief', 'strokes', 'shadow'] as const) {
    const rule = family.depth[layer]
    template.depth[layer].on = rule.on
    template.depth[layer].amount = (rule.amount[0] + rule.amount[1]) / 2
  }
  template.depth.light = { on: family.depth.light.on, height: (family.depth.light.amount[0] + family.depth.light.amount[1]) / 2 }
  return template
}

/**
 * A new background in `project`: `base` (any background of it, for the
 * parts a style does not carry) with a new variation seed, its linked
 * stages derived from the style at the project's spread (derive.ts).
 * Nothing is overridden, so it follows the project from the start. Not
 * the primary.
 */
export function newBackgroundPreset(project: Project, base: Preset, id: string, seed: number, family: Family): Preset {
  const start: Preset = {
    ...followStyle(structuredClone(base), [], project.style),
    id,
    project: project.id,
    overrides: [],
    variation: seed,
    photo: null,
    meta: { ...base.meta, name: `${project.name} ${id.slice(project.id.length + 1)}`, project: undefined },
  }
  return shuffleVariation(start, [], seed, project, family)
}

/**
 * The project's style re-rolled from the family defaults, within the
 * house-widened ranges, at variety `1 − housePull` (SPEC.md §4). The seed
 * picks the hue the defaults start from.
 */
export function rerollStyle(blank: Preset, family: Family, seed: number): ProjectStyle {
  const hue = Math.floor(mulberry32(seed ^ 0x9e3779b9)() * 360)
  const template = familyTemplate(blank, family, hue, seed)
  const draft: CardDraft = { ...template }
  const rolled = rollScoped(template, draft, family, seed, 'all', { spread: 1 - family.housePull })
  return styleOf({ ...template, ...rolled })
}
