import type { Preset } from '../model/types'
import type { CardHandle } from '../shader/handle'

export interface WebmExportOptions {
  scale: number
  /** Called per encoded frame with progress 0 to 1, for the Export sheet. */
  onProgress?: (fraction: number) => void
}

/** True when this browser can run the WebCodecs path at all. */
export function canExportWebm(): boolean {
  return typeof VideoEncoder !== 'undefined'
}

/**
 * Renders `loop.seconds × loop.fps` frames at exact times and encodes them
 * with WebCodecs into a WebM Blob. Frame-exact by construction, unlike
 * MediaRecorder. Day-one step 5 if it cooperates, else week one.
 */
export async function exportWebm(
  _handle: CardHandle,
  _preset: Preset,
  _options: WebmExportOptions,
): Promise<Blob> {
  throw new Error('exportWebm: not implemented (SPEC.md §7, day one step 5)')
}
