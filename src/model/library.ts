import { useSyncExternalStore } from 'react'
import { familyTemplate, newBackgroundPreset, nextBackgroundId } from './background'
import { dropCard, ensureCard, getDraft, getLink, hasCard, moveCard, reloadFile, setDraft } from './cards'
import { getFamily } from './family'
import { PRESETS, blankPreset, onPresetFiles } from './presets'
import { getProject, registerBackground, renamePrimary } from './projects'
import { newSeed, rollScoped } from './shuffle'
import type { Preset } from './types'
import { validatePreset } from './validate'

/*
 * The library: every card the grid shows. It starts as the files under
 * presets/, in file order, and a session may add cards (New, Duplicate),
 * rename them (the id follows the name; Save moves the file) and remove
 * them. Those changes live in localStorage until a Save or a Delete puts
 * them on disk (dev) or for good (hosted). Nothing here maps a card to a
 * Portfolio project: a background is imported per card, by id.
 */

const STORAGE_KEY = 'shaderlab:library'

interface Entry {
  preset: Preset
  /** The file this card stands for, or null for a card not yet saved. */
  source: string | null
}

interface Stored {
  /** Cards added or renamed this session, each with its source file. */
  extra: Entry[]
  /** File cards removed this session. */
  removed: string[]
}

let entries: Entry[] = PRESETS.map((preset) => ({ preset, source: preset.id }))
/** File cards taken out of the library while their file is still there. */
const removed = new Set<string>()
const listeners = new Set<() => void>()

try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Stored | null
  if (stored) {
    for (const id of stored.removed ?? []) removed.add(id)
    entries = entries.filter((e) => !removed.has(e.preset.id))
    for (const extra of stored.extra ?? []) {
      // Stored cards go through the validator like a file would, so one
      // written under an older schema is migrated or dropped, never
      // handed to the panel half-shaped.
      const result = validatePreset(extra?.preset)
      if (!result.ok) {
        console.warn('[ShaderLab] dropping a stored library card that no longer validates', result.issues)
        continue
      }
      const preset = result.value
      const source = typeof extra.source === 'string' ? extra.source : null
      // Saved after all: the file is the truth, and the overlay keeps any
      // edits on top of it.
      if (entries.some((e) => e.preset.id === preset.id)) continue
      const at = source ? entries.findIndex((e) => e.source === source) : -1
      if (at >= 0) entries[at] = { preset, source }
      // A card whose file has gone from disk is unsaved again.
      else entries.push({ preset, source: null })
    }
  }
} catch {
  // Unreadable: the files it is.
}
for (const e of entries) ensureCard(e.preset)

function persist() {
  const fileIds = new Set(PRESETS.map((p) => p.id))
  const extra = entries.filter((e) => e.source === null || e.source !== e.preset.id || !fileIds.has(e.preset.id))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ extra, removed: [...removed] } satisfies Stored))
  } catch {
    // Storage blocked: the library lives for the session only.
  }
}

const notify = () => {
  for (const l of listeners) {
    try {
      l()
    } catch (err) {
      console.error('[ShaderLab] library listener failed', err)
    }
  }
}

let snapshot: Preset[] = entries.map((e) => e.preset)
const refresh = () => {
  snapshot = entries.map((e) => e.preset)
  persist()
  notify()
}

export const getCards = (): Preset[] => snapshot
export const cardById = (id: string) => entries.find((e) => e.preset.id === id)?.preset
export const sourceOf = (id: string): string | null | undefined => entries.find((e) => e.preset.id === id)?.source

export function subscribeLibrary(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCards(): Preset[] {
  return useSyncExternalStore(subscribeLibrary, getCards)
}

export function useSource(id: string): string | null | undefined {
  return useSyncExternalStore(subscribeLibrary, () => sourceOf(id))
}

/** `Untitled n` → `untitled-n`, unique among the other cards (`self` is the
    card being named, whose own id does not count against it). */
export function slugify(name: string, self?: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'card'
  const taken = (id: string) => id !== self && entries.some((e) => e.preset.id === id)
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}-${n}`
  return id
}

function nextUntitled(): string {
  const taken = new Set(entries.map((e) => e.preset.meta.name))
  for (let n = 1; ; n++) if (!taken.has(`Untitled ${n}`)) return `Untitled ${n}`
}

/** A fresh card from the family defaults with a random seed. */
export function newCard(): Preset {
  const family = getFamily()
  const name = nextUntitled()
  const id = slugify(name)
  const seed = newSeed()
  const template = familyTemplate(blankPreset(id, name), family, Math.floor(Math.random() * 360), seed)
  // The roll gives it a face; the rolled values become its baseline.
  const rolled = rollScoped(template, { ...template }, family, seed, 'all', { spread: 1 })
  const preset: Preset = registerBackground({ ...template, ...rolled })
  entries.push({ preset, source: null })
  ensureCard(preset)
  refresh()
  return preset
}

/**
 * A new background in a project: id `<project>-<n>`, a new seed, one
 * shuffle from the project's style at its spread, added after the
 * project's last card. Unsaved, like New and Duplicate, until Save.
 */
export function newBackground(projectId: string): Preset | undefined {
  const project = getProject(projectId)
  if (!project) return undefined
  const members = entries.filter((e) => getLink(e.preset.id).project === projectId)
  // The project's primary, else any of its cards, supplies what a style
  // does not carry (canvas, loop, states, finish).
  const base = members.find((e) => e.preset.id === project.primary)?.preset ?? members[0]?.preset ?? blankPreset(projectId, project.name)
  const id = nextBackgroundId(projectId, entries.map((e) => e.preset.id))
  const preset = newBackgroundPreset(project, { ...base, ...getDraftOr(base) }, id, newSeed(), getFamily())
  const last = members.length ? entries.lastIndexOf(members[members.length - 1]) : entries.length - 1
  entries.splice(last + 1, 0, { preset, source: null })
  ensureCard(preset)
  refresh()
  return preset
}

const getDraftOr = (preset: Preset) => (hasCard(preset.id) ? getDraft(preset.id) : {})

export function duplicateCard(id: string): Preset | undefined {
  const at = entries.findIndex((e) => e.preset.id === id)
  if (at < 0) return undefined
  const original = entries[at].preset
  const name = `${original.meta.name} copy`
  const newId = slugify(name)
  const draft = structuredClone(getDraft(id))
  // A copy stays in the original's project, with the original's overrides.
  const link = getLink(id)
  const preset: Preset = {
    ...structuredClone(original),
    ...draft,
    id: newId,
    project: link.project,
    overrides: [...link.overrides],
    seed: newSeed(),
    meta: { ...original.meta, name, project: undefined },
  }
  entries.splice(at + 1, 0, { preset, source: null })
  ensureCard(preset)
  refresh()
  return preset
}

/** Renames in place: the id follows the name, the draft and marks follow the id. */
export function renameCard(id: string, name: string): Preset | undefined {
  const at = entries.findIndex((e) => e.preset.id === id)
  const trimmed = name.trim()
  if (at < 0 || !trimmed) return undefined
  const entry = entries[at]
  const newId = slugify(trimmed, id)
  const preset: Preset = { ...entry.preset, id: newId, meta: { ...entry.preset.meta, name: trimmed } }
  // The library changes first, so a cell still showing the old id has
  // left by the time the card store notifies.
  entries[at] = { preset, source: entry.source }
  snapshot = entries.map((e) => e.preset)
  if (newId !== id) {
    moveCard(id, newId, preset)
    renamePrimary(getLink(newId).project, id, newId)
  }
  refresh()
  return preset
}

export function removeCard(id: string) {
  const entry = entries.find((e) => e.preset.id === id)
  if (entry?.source) removed.add(entry.source)
  entries = entries.filter((e) => e.preset.id !== id)
  dropCard(id)
  refresh()
}

/** The card now stands for the file with its own id (set before the file
    is written, so a reload mid-save still shows one card, not two). */
export function markCardSaved(id: string) {
  const entry = entries.find((e) => e.preset.id === id)
  if (!entry) return
  entry.preset = { ...entry.preset, ...getDraft(id), ...getLink(id) }
  if (entry.source) removed.delete(entry.source)
  entry.source = id
  removed.delete(id)
  refresh()
}

/** The write failed: the card is unsaved (or still its old file) again. */
export function unmarkCardSaved(id: string, source: string | null) {
  const entry = entries.find((e) => e.preset.id === id)
  if (!entry) return
  entry.source = source
  refresh()
}

/**
 * Dev: presets/ changed on disk (a save from here, or Joe's editor). A
 * file that changed is its card's baseline again; a new file becomes a
 * card, or the file of the unsaved card with its id; a file that went is
 * its card gone, unless the card had moved on (a rename) first.
 */
function reconcileFiles(files: Preset[]) {
  const byId = new Map(files.map((p) => [p.id, p]))
  for (const entry of entries) {
    const file = byId.get(entry.preset.id)
    if (!file) continue
    if (entry.source === entry.preset.id) {
      entry.preset = file
      reloadFile(file)
    } else {
      // Unsaved or renamed, and its file has just landed.
      entry.preset = { ...file, ...getDraft(entry.preset.id) }
      entry.source = entry.preset.id
      reloadFile(file)
    }
  }
  const present = new Set(entries.map((e) => e.preset.id))
  for (const file of files) {
    if (present.has(file.id) || removed.has(file.id)) continue
    entries.push({ preset: file, source: file.id })
    ensureCard(file)
  }
  for (const entry of [...entries]) {
    if (entry.source && entry.source === entry.preset.id && !byId.has(entry.source)) {
      entries = entries.filter((e) => e !== entry)
      dropCard(entry.preset.id)
    }
  }
  for (const id of [...removed]) if (!byId.has(id)) removed.delete(id)
  refresh()
}

if (import.meta.hot) onPresetFiles(reconcileFiles)

/** Writes a draft through the card store; here so callers have one import. */
export const setCardDraft = setDraft
