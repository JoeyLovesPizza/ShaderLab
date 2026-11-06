import { cardsInProject, getDraft, getLink, replaceDraft } from './cards'
import { PROJECTS, PROJECT_FILES, onPresetFiles } from './presets'
import { followStyle, overridesAfterEdit, projectFromPreset, relinkDraft } from './project'
import { stableStringify } from './stable'
import type { LinkPath, Preset, Project, ProjectStyle } from './types'
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
 * A project's style edited: every background where a path is linked takes
 * the new value; overridden paths stay as they are. Not an edit of those
 * backgrounds, so nothing is marked overridden.
 */
export function setProjectStyle(id: string, style: ProjectStyle) {
  const project = projects.get(id)
  if (!project) return
  projects.set(id, { ...project, style: structuredClone(style) })
  for (const cardId of cardsInProject(id)) {
    replaceDraft(cardId, followStyle(getDraft(cardId), getLink(cardId).overrides, style))
  }
  commit()
}

/** Drops one override on a background and takes the project's value for it again. */
export function relink(cardId: string, path: LinkPath) {
  const link = getLink(cardId)
  const project = projects.get(link.project)
  if (!project) return
  replaceDraft(
    cardId,
    relinkDraft(getDraft(cardId), project, path),
    link.overrides.filter((p) => p !== path),
  )
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
