import { srgbToOklab } from '../palette/ramp'
import { stage, type CardState } from './stage'

/*
 * The Rail's tonal check (SPEC.md §2): the L range of a card's poster,
 * rendered small through the shared stage so it is the real field, grain
 * and all. Under 0.35 there is nowhere for a UI layer's shadow to read.
 */

const W = 64
const H = 43

let scratch: HTMLCanvasElement | null = null

export interface LRange {
  min: number
  max: number
}

export function lRange(state: CardState, time: number): LRange {
  scratch ??= document.createElement('canvas')
  stage.renderInto(scratch, state, time, 1, { width: W, height: H })
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { min: 0, max: 0 }
  const { data } = ctx.getImageData(0, 0, W, H)
  let min = 1
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const [L] = srgbToOklab([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255])
    if (L < min) min = L
    if (L > max) max = L
  }
  return { min, max }
}
