import { useSyncExternalStore } from 'react'
import { rerollStyle } from './background'
import { cardsInProject, clearDirty, getDirty, getDraft, getLink, replaceDraft, setDraft } from './cards'
import { deriveLinked, shuffleVariation } from './derive'
import { getFamily, subscribeFamily } from './family'
import { PROJECTS, PROJECT_FILES, blankPreset, onPresetFiles } from './presets'
import { overridesAfterEdit, projectFromPreset } from './project'
import { newSeed, rollScoped } from './shuffle'
import { stableStringify } from './stable'
import { DEFAULT_SPREAD, type LinkPath, type Preset, type Project, type ProjectStyle } from './types'
import { validateProject } from './validate'

/*
 * The projects as one small store, beside the card store: each project's
 * style, spread and primary, and the link between a project and its
 * backgrounds (SPEC.md §4). The files under presets/projects/ are the
 * truth, and an edit is an overlay until a card save writes the project
 * file (src/export/save.ts), the way a card's edits are. A project that
 * has no file yet (synthesized from a background, or born with a new
 * card) is "new" until then. The overlay survives a reload through
 * localStorage; cards.ts clears it with the others when the family
 * version moves.
 */

const STORAGE_KEY = 'shaderlab:projects'

const projects = new Map<string, Project>(PROJECTS.map((p) => [p.id, p]))
/** The project as its file (or its synthesis) stands, by id. */
const baselines = new Map<string, string>(PROJECTS.map((p) => [p.id, stableStringify(p)]))
/** Projects with a file on disk; the rest are "new". */
const onDisk = new Set<string>(PROJECT_FILES.map((p) => p.id))
const listeners = new Set<() => void>()
let snapshot: Project[] = [...projects.values()]

try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
  for (const [id, raw] of Object.entries(stored)) {
    const result = validateProject(raw)
    if (result.ok && result.value.id === id) projects.set(id, result.value)
  }
  snapshot = [...projects.values()]
} catch {
  // Storage blocked or garbage: the files stand.
}

function persist() {
  const overlay: Record<string, Project> = {}
  for (const [id, project] of projects) if (baselines.get(id) !== stableStringify(project)) overlay[id] = project
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay))
  } catch {
    // Storage blocked: edits live for the session only.
  }
}

const notify = () => {
  for (const l of listeners) {
    try {
      l()
    } catch (err) {
      console.error('[ShaderLab] project listener failed', err)
    }
  }
}

function commit() {
  snapshot = [...projects.values()]
  persist()
  notify()
}

export const getProject = (id: string): Project | undefined => projects.get(id)
export const getProjects = (): Project[] => snapshot

export function subscribeProjects(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A card's linked stages derived again from its project (derive.ts): the
 * style, spread and house pull may have moved, its variation and its own
 * stages have not. Not an edit, so nothing becomes an override; and the
 * draft is only replaced when a value really changed, so a card that
 * still equals its file is not marked modified.
 */
function rederive(cardId: string, project: Project | undefined = projects.get(getLink(cardId).project)) {
  if (!project) return
  const link = getLink(cardId)
  const draft = getDraft(cardId)
  const next = deriveLinked(draft, link.overrides, link.variation, project, getFamily())
  if (stableStringify(next) !== stableStringify(draft)) replaceDraft(cardId, next)
}

/**
 * A project's style edited: every background re-derives, so each linked
 * stage follows the new style (at its own variation); overridden stages
 * stay as they are.
 */
export function setProjectStyle(id: string, style: ProjectStyle) {
  const project = projects.get(id)
  if (!project) return
  const next = { ...project, style: structuredClone(style) }
  projects.set(id, next)
  for (const cardId of cardsInProject(id)) rederive(cardId, next)
  commit()
}

/** The project's spread; its backgrounds re-derive live. Saves into the
    project file the way a style edit does. */
export function setProjectSpread(id: string, spread: number) {
  const project = projects.get(id)
  if (!project || project.spread === spread) return
  const next = { ...project, spread }
  projects.set(id, next)
  for (const cardId of cardsInProject(id)) rederive(cardId, next)
  commit()
}

// House pull and the other ranges the shuffle reads belong to the family,
// not to a project: when they move, every background in every project
// derives again. Light, the family's angle and grain animation do not feed
// the roll; the motion ranges do.
const rollInputs = (f: ReturnType<typeof getFamily>) =>
  stableStringify({ ...f, light: null, motion: { ...f.motion, angle: null }, texture: { ...f.texture, animate: null }, meta: null })
let seenFamily = rollInputs(getFamily())
subscribeFamily(() => {
  const now = rollInputs(getFamily())
  if (now === seenFamily) return
  seenFamily = now
  for (const project of projects.values()) for (const cardId of cardsInProject(project.id)) rederive(cardId, project)
})

/** The background that ships for the project; saves into the project file the way a style edit does. */
export function setPrimary(id: string, cardId: string) {
  const project = projects.get(id)
  if (!project || project.primary === cardId) return
  projects.set(id, { ...project, primary: cardId })
  commit()
}

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribeProjects, getProjects)
}

/** The spread of the project a card belongs to. */
export const spreadOfCard = (cardId: string): number => projects.get(getLink(cardId).project)?.spread ?? DEFAULT_SPREAD

export function useCardSpread(cardId: string): number {
  return useSyncExternalStore(subscribeProjects, () => spreadOfCard(cardId))
}

/**
 * A background shuffled from its project: a new variation seed, and its
 * linked stages derived from the style at the project's spread (SPEC.md
 * §4). Nothing becomes an override: stages the background already owns
 * stay as they are and are not rolled. "Shuffle (all fields)"
 * (`ignoreDirty`) gives the hand edits up too: every stage is linked again
 * first. A card with no project shuffles from its own values.
 */
export function shuffleBackground(cardId: string, seed: number, options: { ignoreDirty?: boolean } = {}) {
  const draft = getDraft(cardId)
  const link = getLink(cardId)
  const project = projects.get(link.project)
  if (!project) {
    setDraft(cardId, rollScoped(draft, draft, getFamily(), seed, 'all', { dirty: getDirty(cardId), ignoreDirty: options.ignoreDirty }))
    return
  }
  const overrides = options.ignoreDirty ? [] : link.overrides
  if (options.ignoreDirty) clearDirty(cardId)
  replaceDraft(cardId, shuffleVariation(draft, overrides, seed, project, getFamily()), { overrides, variation: seed })
}

/** The origin and spread a scoped roll (a mode changed on the panel) reads. */
export function shuffleSource(cardId: string): { origin: ProjectStyle | undefined; spread: number | undefined } {
  const project = projects.get(getLink(cardId).project)
  return { origin: project?.style, spread: project?.spread }
}

/**
 * Re-rolls the project's style from the family defaults, within the
 * house-widened ranges at variety `1 − housePull`; its linked backgrounds
 * follow (setProjectStyle).
 */
export function shuffleProject(id: string, seed = newSeed()) {
  const project = projects.get(id)
  if (!project) return
  setProjectStyle(id, rerollStyle(blankPreset(id, project.name), getFamily(), seed))
}

/** Drops one override on a background: that stage follows the project again. */
export function relink(cardId: string, path: LinkPath) {
  const link = getLink(cardId)
  const project = projects.get(link.project)
  if (!project) return
  const overrides = link.overrides.filter((p) => p !== path)
  replaceDraft(cardId, deriveLinked(getDraft(cardId), overrides, link.variation, project, getFamily()), { overrides })
}

/**
 * A card born in the session (New, Duplicate) joins its project: with no
 * project of that id yet, one is made from the card; with one, the card's
 * stages that differ from it are overrides, so what shows does not move.
 * Returns the card with its overrides set.
 */
export function registerBackground(preset: Preset): Preset {
  const project = projects.get(preset.project)
  if (!project) {
    projects.set(preset.project, projectFromPreset(preset))
    commit()
    return { ...preset, overrides: [] }
  }
  return { ...preset, overrides: overridesAfterEdit(project.style, preset, []) }
}

/** A renamed background that was its project's primary stays it. */
export function renamePrimary(projectId: string, from: string, to: string) {
  const project = projects.get(projectId)
  if (!project || project.primary !== from) return
  projects.set(projectId, { ...project, primary: to })
  commit()
}

/** Whether a card save has to write this project's file too. */
export function projectNeedsSave(id: string): boolean {
  const project = projects.get(id)
  return !!project && (!onDisk.has(id) || baselines.get(id) !== stableStringify(project))
}

/** The project file now holds the project as it stands. */
export function markProjectSaved(id: string) {
  const project = projects.get(id)
  if (!project) return
  baselines.set(id, stableStringify(project))
  onDisk.add(id)
  commit()
}

// Dev: presets/projects/ changed on disk (a save from here, or Joe's
// editor). A project with no edits of its own follows its file.
if (import.meta.hot) {
  onPresetFiles((_presets, files) => {
    for (const file of files) {
      const current = projects.get(file.id)
      if (!current || baselines.get(file.id) === stableStringify(current)) projects.set(file.id, file)
      baselines.set(file.id, stableStringify(file))
      onDisk.add(file.id)
    }
    commit()
  })
}
