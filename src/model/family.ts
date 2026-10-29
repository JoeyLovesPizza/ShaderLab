import { useSyncExternalStore } from 'react'
import familyJson from '../../presets/family.json'
import type { Family } from './types'
import { describe, validateFamily } from './validate'

/*
 * The family as one small store: what every card shares and the bounds
 * the shuffle respects (SPEC.md §2). presets/masses/family.json is the
 * source of truth and is validated on load; a broken file never stops the
 * page, the built-in family stands in and the error is shown. The Motion
 * folder edits speed in the in-memory copy. Not persisted.
 */

export const DEFAULT_FAMILY: Family = {
  schema: 2,
  shader: 'masses@1',
  variety: 0.6,
  base: { value: [0.25, 0.88], chromaMax: 0.08 },
  masses: {
    count: [2, 3],
    size: [0.55, 1.1],
    softness: [0.4, 0.9],
    x: [0.9, 1.4],
    y: [-0.2, 1.2],
    chromaMax: 0.18,
    boldMax: 0.22,
    boldAllowed: true,
  },
  texture: { grain: 0.06, range: [0.04, 0.08], animate: false },
  motion: { driftRadius: 0.1, driftRange: [0.03, 0.2], speed: 2, amount: 0.6, angle: 20 },
  finish: {
    motionBlur: { allowed: true, length: [0.05, 0.2], intensity: [0.4, 0.8] },
    layerBlur: { allowed: true, radius: [0.02, 0.08], intensity: [0.4, 0.8] },
  },
  captionZone: 0.3,
  depth: {
    curve: { on: true, allowed: true, amount: [0.15, 0.45] },
    parallax: { on: true, allowed: true, amount: [0.3, 0.8] },
    haze: { on: true, allowed: true, amount: [0.1, 0.4] },
    swirl: { on: false, allowed: true, amount: [0.2, 0.4] },
    relief: { on: false, allowed: true, amount: [0.15, 0.35], frequency: 85, twist: 6 },
    shadow: { on: false, allowed: false, amount: [0.3, 0.7] },
  },
  meta: { name: 'built-in fallback', created: '2026-10-28', version: 2 },
}

/** The load error, when family.json failed and the fallback is in use. */
export let FAMILY_ERROR: string | null = null

function load(json: unknown): Family {
  const result = validateFamily(json)
  if (result.ok) {
    FAMILY_ERROR = null
    return result.value
  }
  FAMILY_ERROR = `presets/family.json: ${describe(result.issues)}`
  console.error(`[ShaderLab] ${FAMILY_ERROR}; using the built-in family`)
  return DEFAULT_FAMILY
}

let current: Family = load(familyJson)
const listeners = new Set<() => void>()

export const getFamily = (): Family => current

export function setFamily(patch: (family: Family) => Family) {
  current = patch(current)
  for (const l of listeners) l()
}

export function subscribeFamily(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useFamily(): Family {
  return useSyncExternalStore(subscribeFamily, getFamily)
}

// An edit to family.json lands here without a reload: the new file is
// validated and, if it passes, becomes the family every card reads.
if (import.meta.hot) {
  import.meta.hot.accept('../../presets/family.json', (mod) => {
    const result = validateFamily(mod?.default)
    if (!result.ok) {
      console.warn('[ShaderLab] presets/masses/family.json is invalid; keeping the previous family', result.issues)
      return
    }
    FAMILY_ERROR = null
    current = result.value
    for (const l of listeners) l()
  })
}
