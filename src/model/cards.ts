import { useSyncExternalStore } from 'react'
import { getFamily } from './family'
import { PRESETS, blankPreset } from './presets'
import { overridesAfterEdit } from './project'
import type { CardDraft, LinkPath, Preset } from './types'
import { diffPaths, stableStringify } from './stable'
import { cleanOverrides, migrateOverlay } from './validate'

/*
 * Every card's working copy, as one store. The preset files are the source
 * of truth: each card starts as a copy of its file (the baseline), and any
 * edit, panel or shuffle, is an overlay on top of it. Overlays survive a
 * reload through localStorage, show as "modified" on the cell and in the
 * header, and only reach disk through "Save to file" (src/export/save.ts).
 * "Revert to file" drops the overlay. A shuffle therefore never silently
 * replaces a file.
 */

const STORAGE_KEY = 'shaderlab:overlays'
const DIRTY_KEY = 'shaderlab:dirty'
const LINKS_KEY = 'shaderlab:links'
const VERSION_KEY = 'shaderlab:familyVersion'

// When the family's defaults move on (a new `meta.version`), overlays and
// panel state from an older session would keep the old motion, loop or
// pauses alive over the new files. Cleared once, then the version is noted.
try {
  const current = getFamily().meta.version ?? 1
  const stored = Number(localStorage.getItem(VERSION_KEY) ?? '0')
  if (stored < current) {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(DIRTY_KEY)
    localStorage.removeItem(LINKS_KEY)
    // The project store's own overlay (projects.ts).
    localStorage.removeItem('shaderlab:projects')
    // The library's own cards (library.ts) were written against the old
    // schema too.
    localStorage.removeItem('shaderlab:library')
    for (const key of Object.keys(localStorage)) if (key.startsWith('dialkit:')) localStorage.removeItem(key)
    localStorage.setItem(VERSION_KEY, String(current))
  }
} catch {
  // Storage blocked: nothing stale to clear.
}

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

export { diffPaths, stableStringify }

const same = (a: CardDraft, b: CardDraft) => stableStringify(a) === stableStringify(b)

/** The files, as drafts. */
const baselines = new Map<string, CardDraft>(PRESETS.map((p) => [p.id, draftOf(p)]))
const drafts = new Map<string, CardDraft>(PRESETS.map((p) => [p.id, draftOf(p)]))
const listeners = new Set<() => void>()

/*
 * Which project each card follows, and the stage paths it has taken for
 * itself (SPEC.md §4). Held beside the drafts because a draft is only the
 * editable part of a card. The baseline is the file's; an override added
 * by hand survives a reload through localStorage like an overlay does.
 */
export interface Link {
  project: string
  overrides: LinkPath[]
  /** The seed its linked stages derive from, or null (derive.ts). */
  variation: number | null
}
const linkOfPreset = (p: Preset): Link => ({ project: p.project, overrides: [...p.overrides], variation: p.variation ?? null })
const links = new Map<string, Link>(PRESETS.map((p) => [p.id, linkOfPreset(p)]))
const linkBaselines = new Map<string, Link>(PRESETS.map((p) => [p.id, linkOfPreset(p)]))
const sameLink = (a: Link | undefined, b: Link | undefined) => !!a && !!b && a.project === b.project && a.variation === b.variation && a.overrides.join() === b.overrides.join()

// Only the bones: an overlay from an older build lacks the keys added
// since (finish, light, strokes), and the migration fills them in.
function looksLikeDraft(value: unknown): value is CardDraft {
  return typeof value === 'object' && value !== null && 'masses' in value && 'base' in value
}

/** An overlay through the validator's migration, over the card's file;
    null (with a warning) when it cannot be made current. */
export function migrateDraft(preset: Preset, overlay: unknown): CardDraft | null {
  const migrated = migrateOverlay(preset, overlay)
  if (!migrated) {
    console.warn(`[ShaderLab] dropping the stored overlay for "${preset.id}": it no longer validates; the file stands`)
    return null
  }
  for (const w of migrated.warnings) console.warn(`[ShaderLab] overlay for "${preset.id}": ${w.path}: ${w.message}`)
  return migrated.draft
}

// Overlays from the last session, each migrated like a file would be
// (an overlay written by an earlier build lacks the fields added since),
// applied over the files where they still validate. Anything unreadable
// is dropped rather than trusted.
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
  for (const [id, overlay] of Object.entries(stored)) {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset || !looksLikeDraft(overlay)) continue
    const draft = migrateDraft(preset, overlay)
    if (draft) drafts.set(id, draft)
  }
} catch {
  // Storage blocked or garbage: the files it is.
}

try {
  const stored = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') as Record<string, { overrides?: unknown; variation?: unknown } | undefined>
  for (const [id, entry] of Object.entries(stored)) {
    const link = links.get(id)
    if (!link || !entry || typeof entry !== 'object') continue
    const variation = typeof entry.variation === 'number' && Number.isFinite(entry.variation) ? entry.variation : null
    links.set(id, { project: link.project, overrides: cleanOverrides(entry.overrides), variation })
  }
} catch {
  // Storage blocked or garbage: the files' links stand.
}

/*
 * Dirty fields: leaf paths (`masses.1.hue`, `depth.haze.amount`) Joe set by
 * hand. A mode change or a Shuffle never rolls them; "Shuffle (all
 * fields)" does, and the per-item Lock stays the explicit version. Kept
 * beside the overlays so they survive a reload.
 */
const dirty = new Map<string, Set<string>>()
try {
  const stored = JSON.parse(localStorage.getItem(DIRTY_KEY) ?? '{}') as Record<string, unknown>
  for (const [id, paths] of Object.entries(stored)) {
    if (baselines.has(id) && Array.isArray(paths)) dirty.set(id, new Set(paths.filter((p) => typeof p === 'string')))
  }
} catch {
  // Nothing recorded, or unreadable: nothing is dirty.
}

function persist() {
  const overlays: Record<string, CardDraft> = {}
  for (const [id, draft] of drafts) {
    const base = baselines.get(id)
    if (base && !same(draft, base)) overlays[id] = draft
  }
  const dirtyOut: Record<string, string[]> = {}
  for (const [id, paths] of dirty) if (paths.size) dirtyOut[id] = [...paths]
  const linksOut: Record<string, { overrides: LinkPath[]; variation: number | null }> = {}
  for (const [id, link] of links) {
    if (!sameLink(link, linkBaselines.get(id))) linksOut[id] = { overrides: link.overrides, variation: link.variation }
  }
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(linksOut))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overlays))
    localStorage.setItem(DIRTY_KEY, JSON.stringify(dirtyOut))
  } catch {
    // Storage blocked: edits live for the session only.
  }
}

export function getDirty(id: string): ReadonlySet<string> {
  return dirty.get(id) ?? new Set()
}

export function markDirty(id: string, paths: string[]) {
  if (!paths.length) return
  const set = dirty.get(id) ?? new Set<string>()
  for (const p of paths) set.add(p)
  dirty.set(id, set)
  persist()
  notify()
}

/** Forgets the hand edits (keeps their values), so rolls may move them again. */
export function clearDirty(id: string) {
  dirty.delete(id)
  persist()
  notify()
}

// One listener that throws (a panel asked about a card that has just been
// renamed away) must not stop the rest from hearing, or the page goes
// stale around it.
const notify = () => {
  for (const l of listeners) {
    try {
      l()
    } catch (err) {
      console.error('[ShaderLab] card listener failed', err)
    }
  }
}

export function getDraft(id: string): CardDraft {
  const draft = drafts.get(id)
  if (!draft) throw new Error(`No card draft for "${id}"`)
  return draft
}

export const hasCard = (id: string) => drafts.has(id)

/** A card the library added (new, duplicated, or a renamed file): its
    preset is the baseline, and any stored overlay goes over it. */
export function ensureCard(preset: Preset) {
  if (baselines.has(preset.id)) return
  baselines.set(preset.id, draftOf(preset))
  if (!links.has(preset.id)) links.set(preset.id, linkOfPreset(preset))
  if (!linkBaselines.has(preset.id)) linkBaselines.set(preset.id, linkOfPreset(preset))
  if (!drafts.has(preset.id)) drafts.set(preset.id, draftOf(preset))
  notify()
}

/** A rename: the draft, baseline and dirty marks follow the card to its new id. */
export function moveCard(from: string, to: string, preset: Preset) {
  const draft = drafts.get(from)
  const base = baselines.get(from)
  const marks = dirty.get(from)
  const link = links.get(from)
  const linkBase = linkBaselines.get(from)
  drafts.delete(from)
  baselines.delete(from)
  dirty.delete(from)
  links.delete(from)
  linkBaselines.delete(from)
  links.set(to, link ?? linkOfPreset(preset))
  linkBaselines.set(to, linkBase ?? linkOfPreset(preset))
  drafts.set(to, draft ?? draftOf(preset))
  baselines.set(to, base ?? draftOf(preset))
  if (marks) dirty.set(to, marks)
  persist()
  notify()
}

/** The file changed on disk (saved here, or edited by hand): it is the
    baseline again, and a card with no edits of its own follows it. */
export function reloadFile(preset: Preset) {
  const base = draftOf(preset)
  const old = baselines.get(preset.id)
  const draft = drafts.get(preset.id)
  const oldLink = links.get(preset.id)
  const unedited = !old || !draft || same(draft, old)
  baselines.set(preset.id, base)
  if (unedited) drafts.set(preset.id, draftOf(preset))
  // Its overrides follow the file only while the card has none of its own.
  if (unedited || sameLink(oldLink, linkBaselines.get(preset.id))) links.set(preset.id, linkOfPreset(preset))
  linkBaselines.set(preset.id, linkOfPreset(preset))
  persist()
  notify()
}

export function dropCard(id: string) {
  drafts.delete(id)
  baselines.delete(id)
  dirty.delete(id)
  links.delete(id)
  linkBaselines.delete(id)
  persist()
  notify()
}

/**
 * An edit by hand or by a roll. Any linked stage it changes becomes an
 * override of this card, so the project stops moving it there (SPEC.md §4).
 */
export function setDraft(id: string, draft: CardDraft) {
  const prev = drafts.get(id)
  const link = links.get(id)
  if (prev && link) {
    const overrides = overridesAfterEdit(prev, draft, link.overrides)
    if (overrides.join() !== link.overrides.join()) links.set(id, { ...link, overrides })
  }
  drafts.set(id, draft)
  persist()
  notify()
}

/** A draft that follows from the project, not from an edit: no override is
    marked. `patch` moves the link with it (a relink, a new variation). */
export function replaceDraft(id: string, draft: CardDraft, patch: Partial<Pick<Link, 'overrides' | 'variation'>> = {}) {
  const link = links.get(id)
  if (link) links.set(id, { ...link, ...patch })
  drafts.set(id, draft)
  persist()
  notify()
}

/** The card's project and overrides now (the baseline's, until an edit). */
export function getLink(id: string): Link {
  return links.get(id) ?? { project: id, overrides: [], variation: null }
}

/** The cards that follow a project. */
export function cardsInProject(projectId: string): string[] {
  return [...links].filter(([, link]) => link.project === projectId).map(([id]) => id)
}

/** True when the card's draft differs from its file. */
export function isModified(id: string): boolean {
  const draft = drafts.get(id)
  const base = baselines.get(id)
  return !!draft && !!base && !same(draft, base)
}

/** Drops the overlay: the card is its file again. */
export function revertToFile(id: string) {
  const base = baselines.get(id)
  if (!base) return
  drafts.set(id, structuredClone(base))
  const linkBase = linkBaselines.get(id)
  if (linkBase) links.set(id, { ...linkBase, overrides: [...linkBase.overrides] })
  dirty.delete(id)
  persist()
  notify()
}

/** After a save: the file now holds this draft, so it is the baseline. */
export function markSaved(id: string, draft: CardDraft) {
  baselines.set(id, structuredClone(draft))
  drafts.set(id, structuredClone(draft))
  const link = links.get(id)
  if (link) linkBaselines.set(id, { ...link, overrides: [...link.overrides] })
  persist()
  notify()
}

export function subscribeCards(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** What a cell shows for an id the store no longer has: a card renamed or
    deleted under it, in the render before it unmounts. A snapshot must
    never throw, or the boundary eats the cell. */
const ORPHAN: CardDraft = draftOf(blankPreset('orphan', 'orphan'))

export function useDraft(id: string): CardDraft {
  return useSyncExternalStore(subscribeCards, () => drafts.get(id) ?? ORPHAN)
}

export function useModified(id: string): boolean {
  return useSyncExternalStore(subscribeCards, () => isModified(id))
}

/** The card's dirty paths as one sorted string, stable for React. */
export function useDirtyPaths(id: string): string {
  return useSyncExternalStore(subscribeCards, () => [...getDirty(id)].sort().join(' '))
}

/** How many linkable stages the card has taken for itself. A string key
    keeps the snapshot comparable; the number is what a cell shows. */
export function useOwnCount(id: string): number {
  return useSyncExternalStore(subscribeCards, () => links.get(id)?.overrides.length ?? 0)
}
