import type { CardDraft } from '../model/types'
import type { UniformValues } from './massesManifest'
import type { CardState } from './stage'

/**
 * What the panel, the state switcher and the export sheet need from a live
 * card. Every method writes to refs, the card store or the renderer; none
 * of them re-renders React per frame.
 */
export interface CardHandle {
  /** Uniforms written past the draft: the state deltas. */
  setUniforms(values: Partial<UniformValues>): void
  /** The card's numbers; goes to the card store, so every view sees it. */
  setDraft(draft: CardDraft): void
  getDraft(): CardDraft
  play(): void
  pause(): void
  isPlaying(): boolean
  /** Playhead in seconds, within the loop. */
  getTime(): number
  /** Move the playhead and draw that frame; the clock continues from here. */
  seek(seconds: number): void
  /** Draw one exact frame without touching the clock. */
  renderAt(seconds: number): void
  /** The card as it is right now, for export. */
  getState(): CardState
}
