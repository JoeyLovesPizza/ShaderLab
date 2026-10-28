import { useSyncExternalStore } from 'react'
import { PRESETS } from './presets'
import type { CardDraft, Preset } from './types'

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
const DRAFT_KEYS: (keyof CardDraft)[] = ['seed', 'modes', 'base', 'masses', 'texture', 'depth', 'finish', 'captionMask', 'loop']

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

function looksLikeDraft(value: unknown): value is CardDraft {
  return typeof value === 'object' && value !== null && DRAFT_KEYS.every((k) => k in (value as object))
}

// Overlays from the last session, applied over the files where they still
// make sense. Anything unreadable is dropped rather than trusted.
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
  for (const [id, overlay] of Object.entries(stored)) {
    if (baselines.has(id) && looksLikeDraft(overlay)) drafts.set(id, overlay)
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

const notify = () => {
  for (const l of listeners) l()
}

export function getDraft(id: string): CardDraft {
  const draft = drafts.get(id)
  if (!draft) throw new Error(`No card draft for "${id}"`)
  return draft
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

export function useDraft(id: string): CardDraft {
  return useSyncExternalStore(subscribeCards, () => getDraft(id))
}

export function useModified(id: string): boolean {
  return useSyncExternalStore(subscribeCards, () => isModified(id))
}

/** The card's dirty paths as one sorted string, stable for React. */
export function useDirtyPaths(id: string): string {
  return useSyncExternalStore(subscribeCards, () => [...getDirty(id)].sort().join(' '))
}
