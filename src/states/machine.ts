/*
 * Workflow states, SPEC.md §6:
 *
 *   Browse (Grid | Rail) ──select──▶ Focus ──▶ [Export sheet] ──done──▶ Focus
 *     ▲                                │ ▲
 *     └──────────escape────────────────┘ └──compose (later)──▶ Compose ──▶ Focus
 *
 * Export is a sheet over Focus, not a state of its own: `exportOpen` on
 * Focus, so closing it leaves the card exactly as it was. Focus also
 * remembers which Browse view it came from, so Escape puts the card back
 * where it was picked up.
 */

/** The Portfolio hero card's footprint; every preset defaults to it. */
export const CARD = { width: 613, height: 408 } as const

/** Browse has two views: the thumbnail grid, and the rail (six presets at
    card scale on #fafafa with an approximate aura), where cohesion is judged. */
export type BrowseView = 'grid' | 'rail'

export type AppState =
  | { kind: 'Browse'; view: BrowseView }
  | { kind: 'Focus'; presetId: string; exportOpen: boolean; returnTo: BrowseView }
  /** Deferred (SPEC.md §7, "Later"): layers over a finished shader on a
      DialKit timeline. In the union now so the reducer is total and the
      transitions in §6 are all written down; nothing renders it yet. */
  | { kind: 'Compose'; presetId: string; returnTo: BrowseView }

export type AppEvent =
  | { type: 'view'; view: BrowseView }
  | { type: 'select'; presetId: string }
  | { type: 'escape' }
  | { type: 'export' }
  | { type: 'done' }
  | { type: 'compose' }

export const initialState: AppState = { kind: 'Browse', view: 'grid' }

/**
 * Pure transition table. Events that don't apply in the current state are
 * ignored and return the same state object, so a stray Escape in Browse is
 * a no-op rather than an error.
 */
export function reduce(state: AppState, event: AppEvent): AppState {
  switch (state.kind) {
    case 'Browse':
      if (event.type === 'view') return { kind: 'Browse', view: event.view }
      if (event.type === 'select') {
        return { kind: 'Focus', presetId: event.presetId, exportOpen: false, returnTo: state.view }
      }
      return state
    case 'Focus':
      if (event.type === 'export') return { ...state, exportOpen: true }
      // Done closes the sheet; Escape closes it first, and only leaves
      // Focus once there is no sheet to close.
      if (event.type === 'done') return { ...state, exportOpen: false }
      if (event.type === 'escape') {
        return state.exportOpen ? { ...state, exportOpen: false } : { kind: 'Browse', view: state.returnTo }
      }
      if (event.type === 'compose') return { kind: 'Compose', presetId: state.presetId, returnTo: state.returnTo }
      return state
    case 'Compose':
      if (event.type === 'escape' || event.type === 'done') {
        return { kind: 'Focus', presetId: state.presetId, exportOpen: false, returnTo: state.returnTo }
      }
      return state
  }
}
