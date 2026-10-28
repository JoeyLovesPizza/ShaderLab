import type { Preset } from '../model/types'
import { stage, type CardState } from '../shader/stage'

export interface PngExportOptions {
  /** Multiplier over the preset's canvas size; 2 for the Portfolio card. */
  scale: number
  /** Seconds into the loop; defaults to the preset's `loop.stillTime`. */
  time?: number
}

/**
 * Renders the poster frame offscreen at `scale` × the preset's canvas and
 * returns it as a PNG Blob. Goes through the shared stage like every other
 * frame, so what is exported is what was on screen.
 */
export async function exportPng(preset: Preset, state: CardState, options: PngExportOptions): Promise<Blob> {
  const width = preset.canvas.width * options.scale
  const height = preset.canvas.height * options.scale
  const canvas = document.createElement('canvas')
  stage.renderInto(canvas, state, options.time ?? preset.loop.stillTime, 1, { width, height }, 'full')
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned nothing'))), 'image/png')
  })
}
