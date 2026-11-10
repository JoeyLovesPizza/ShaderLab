import { followStyle, valueAt, type Styled } from './project'
import { rollScoped } from './shuffle'
import { LINK_PATHS, type CardDraft, type DepthLayerName, type Family, type LinkPath, type Project } from './types'

/*
 * Siblings follow their project (SPEC.md §4, job 3b), as pure functions.
 * A background's `variation` is null (its linked stages equal the style)
 * or a seed (they are one shuffle of the style at that seed and the
 * project's spread). The roll reads only the style, the spread, the
 * family (house pull included) and the seed: never the background's own
 * stages or locks, so a hand edit moves nothing but the stage it owns,
 * and the same four inputs always give the same values.
 */

function assign(target: Styled, path: LinkPath, value: unknown) {
  const copy = structuredClone(value)
  if (path.startsWith('depth.')) (target.depth as unknown as Record<string, unknown>)[path.slice(6) as DepthLayerName] = copy
  else (target as unknown as Record<string, unknown>)[path] = copy
}

/** The one roll behind a variation: the project's style as the origin and
    as the draft, locks cleared so the whole look rolls. `shape` supplies
    the parts a style does not carry (finish, loop, photo, caption). */
export function rollVariation(project: Project, family: Family, variation: number, shape: CardDraft): CardDraft {
  const start = followStyle(shape, [], project.style)
  start.base.locked = false
  for (const m of start.masses) m.locked = false
  return rollScoped(project.style, start, family, variation, 'all', { spread: project.spread })
}

/** `draft` with the stages in `overrides` kept and every other linked
    stage taken from `rolled` (or from the style when there is no roll). */
function apply<T extends CardDraft>(draft: T, overrides: readonly LinkPath[], project: Project, rolled: Styled | null): T {
  const out = followStyle(draft, overrides, project.style)
  if (!rolled) return out
  const own = new Set(overrides)
  for (const path of LINK_PATHS) if (!own.has(path)) assign(out, path, valueAt(rolled, path))
  return out
}

/**
 * The background as it renders: own stages as they are, linked stages
 * equal to the style (no variation) or to its roll at the variation seed.
 * Works on a preset or a draft alike.
 */
export function deriveLinked<T extends CardDraft>(
  draft: T,
  overrides: readonly LinkPath[],
  variation: number | null,
  project: Project,
  family: Family,
): T {
  if (variation === null) return apply(draft, overrides, project, null)
  return apply(draft, overrides, project, rollVariation(project, family, variation, draft))
}

/** A preset derived against its project. */
export function deriveBackground<T extends CardDraft & { overrides: LinkPath[]; variation: number | null }>(preset: T, project: Project, family: Family): T {
  return deriveLinked(preset, preset.overrides, preset.variation, project, family)
}

/**
 * A new variation: the linked stages derived at `variation`, and the
 * parts the roll also sets that are not stages (the draft's seed, which
 * the shader reads, and the finish blurs) taken from the same roll. The
 * stored variation is the one passed in, never the re-roll seed the
 * shuffle may have settled on, so deriving again reproduces this.
 */
export function shuffleVariation<T extends CardDraft>(draft: T, overrides: readonly LinkPath[], variation: number, project: Project, family: Family): T {
  const rolled = rollVariation(project, family, variation, draft)
  const out = apply(draft, overrides, project, rolled)
  out.seed = rolled.seed
  out.finish = structuredClone(rolled.finish)
  return out
}
