import { useSyncExternalStore } from 'react'
import { getFamily } from './family'
import { PRESETS, blankPreset } from './presets'
import type { CardDraft, Preset } from './types'
import { migrateOverlay } from './validate'

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
  })
}

/** JSON with keys sorted at every level: a draft built by the panel and
    one read from a file carry the same values in a different key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

const same = (a: CardDraft, b: CardDraft) => stableStringify(a) === stableStringify(b)

/** The files, as drafts. */
const baselines = new Map<string, CardDraft>(PRESETS.map((p) => [p.id, draftOf(p)]))
const drafts = new Map<string, CardDraft>(PRESETS.map((p) => [p.id, draftOf(p)]))
const listeners = new Set<() => void>()

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overlays))
    localStorage.setItem(DIRTY_KEY, JSON.stringify(dirtyOut))
  } catch {
    // Storage blocked: edits live for the session only.
  }
}

/** Leaf paths where two values differ, dot-separated, arrays by index. */
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
  if (!drafts.has(preset.id)) drafts.set(preset.id, draftOf(preset))
  notify()
}

/** A rename: the draft, baseline and dirty marks follow the card to its new id. */
export function moveCard(from: string, to: string, preset: Preset) {
  const draft = drafts.get(from)
  const base = baselines.get(from)
  const marks = dirty.get(from)
  drafts.delete(from)
  baselines.delete(from)
  dirty.delete(from)
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
  baselines.set(preset.id, base)
  if (!old || !draft || same(draft, old)) drafts.set(preset.id, draftOf(preset))
  persist()
  notify()
}

export function dropCard(id: string) {
  drafts.delete(id)
  baselines.delete(id)
  dirty.delete(id)
  persist()
  notify()
}

export function setDraft(id: string, draft: CardDraft) {
  drafts.set(id, draft)
  persist()
  notify()
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
  dirty.delete(id)
  persist()
  notify()
}

/** After a save: the file now holds this draft, so it is the baseline. */
export function markSaved(id: string, draft: CardDraft) {
  baselines.set(id, structuredClone(draft))
  drafts.set(id, structuredClone(draft))
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
