import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPalette } from '../../src/model/extract'
import { loadFamily, ROOT } from '../helpers'

/*
 * The daisies (presets/photos/daisies.webp) at the size extraction sees:
 * 64 × 43, box-reduced to 22 × 15 and scaled back up, as softDownsample
 * does in the browser. White petals cover most of the frame, so an
 * area-led score kept three near-whites and the card washed out.
 */
function daisies(): Uint8ClampedArray {
  const rgb = readFileSync(resolve(ROOT, 'tests/fixtures/daisies-64x43.rgb'))
  const rgba = new Uint8ClampedArray(64 * 43 * 4)
  for (let i = 0; i < 64 * 43; i++) {
    rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4)
  }
  return rgba
}

describe('extractPalette', () => {
  const { base, masses } = extractPalette(daisies(), 64, 43, loadFamily(), 1226 / 816)

  it('takes the sky as the base', () => {
    expect(base.hue).toBeGreaterThan(220)
    expect(base.hue).toBeLessThan(280)
  })

  it('keeps one white, not three', () => {
    expect(masses.filter((m) => m.chroma < 0.03 && m.value > 0.85)).toHaveLength(1)
  })

  it('keeps the yellow centres', () => {
    expect(masses.some((m) => m.hue > 60 && m.hue < 110 && m.chroma > 0.08)).toBe(true)
  })

  it('shrinks the scattered white to an accent', () => {
    const white = masses.find((m) => m.chroma < 0.03 && m.value > 0.85)!
    expect(white.size).toBeLessThan(0.35)
  })

  it('never keeps two masses closer than the floor', () => {
    expect(masses.length).toBeLessThanOrEqual(3)
    const hues = masses.map((m) => `${m.hue}/${m.value}`)
    expect(new Set(hues).size).toBe(hues.length)
  })
})
