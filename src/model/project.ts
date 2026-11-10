import { stableStringify } from './stable'
import { DEFAULT_SPREAD, LINK_PATHS, type DepthLayerName, type LinkPath, type Preset, type Project, type ProjectStyle } from './types'

/*
 * Projects and backgrounds (SPEC.md §4), as pure functions: no DOM, no
 * stores, so the tests run them in node. A background is a full preset;
 * `overrides` lists the stage paths it owns, and every other LinkPath
 * follows its project's style. Anything not in LINK_PATHS (photo, seed,
 * loop, states, canvas, finish, captionMask, id, meta) is the
 * background's own and never read or written here.
 */

/** Anything with the linkable stages: a preset, a card draft or a style. */
export type Styled = Pick<ProjectStyle, 'base' | 'masses' | 'texture' | 'modes' | 'motion' | 'depth'>

export function valueAt(source: Styled, path: LinkPath): unknown {
  if (path.startsWith('depth.')) return source.depth[path.slice(6) as DepthLayerName]
  return source[path as 'base' | 'masses' | 'texture' | 'modes' | 'motion']
}

function assign(target: Styled, path: LinkPath, value: unknown) {
  const copy = structuredClone(value)
  if (path.startsWith('depth.')) (target.depth as unknown as Record<string, unknown>)[path.slice(6)] = copy
  else (target as unknown as Record<string, unknown>)[path] = copy
}

/** The linkable stages of a preset or draft, deep-copied. */
export function styleOf(source: Styled): ProjectStyle {
  return structuredClone({ base: source.base, masses: source.masses, texture: source.texture, modes: source.modes, motion: source.motion, depth: source.depth })
}

/** The project a background stands for on its own: its current stages are
    the style, and it is its own primary. */
export function projectFromPreset(preset: Preset, spread = DEFAULT_SPREAD): Project {
  return {
    schema: 2,
    id: preset.project || preset.id,
    name: preset.meta.name,
    spread,
    primary: preset.id,
    style: styleOf(preset),
    meta: { created: preset.meta.created },
  }
}

/**
 * Copies the style's value onto every path that is not overridden, into a
 * copy of `target`. Works on a preset or a draft alike.
 */
export function followStyle<T extends Styled>(target: T, overrides: readonly LinkPath[], style: ProjectStyle): T {
  const out = structuredClone(target)
  const own = new Set(overrides)
  for (const path of LINK_PATHS) if (!own.has(path)) assign(out, path, valueAt(style, path))
  return out
}

/** The background as it renders: linked paths take the project's value,
    overridden ones keep their own. */
export function resolveBackground(preset: Preset, project: Project): Preset {
  return followStyle(preset, preset.overrides, project.style)
}

/** The overrides after an edit: every LinkPath whose value changed joins
    them. An edit never removes one; Relink does. In LINK_PATHS order. */
export function overridesAfterEdit(prev: Styled, next: Styled, overrides: readonly LinkPath[]): LinkPath[] {
  const own = new Set(overrides)
  for (const path of LINK_PATHS) {
    if (!own.has(path) && stableStringify(valueAt(prev, path)) !== stableStringify(valueAt(next, path))) own.add(path)
  }
  return LINK_PATHS.filter((p) => own.has(p))
}

/** A draft (or preset) with one path taking the project's value again. */
export function relinkDraft<T extends Styled>(draft: T, project: Project, path: LinkPath): T {
  const out = structuredClone(draft)
  assign(out, path, valueAt(project.style, path))
  return out
}

/** Drops one override and takes the project's value for that path again. */
export function relink(preset: Preset, project: Project, path: LinkPath): Preset {
  return { ...relinkDraft(preset, project, path), overrides: preset.overrides.filter((p) => p !== path) }
}

/** A project's style edited: the new project, and each of its backgrounds
    re-resolved (only linked paths follow; others come back untouched). */
export function applyStyleEdit(project: Project, nextStyle: ProjectStyle, backgrounds: Preset[]): { project: Project; backgrounds: Preset[] } {
  const next: Project = { ...project, style: structuredClone(nextStyle) }
  return {
    project: next,
    backgrounds: backgrounds.map((b) => (b.project === project.id ? resolveBackground(b, next) : b)),
  }
}
