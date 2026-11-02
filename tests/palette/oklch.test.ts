import { describe, expect, it } from 'vitest'
import {
  buildRamp,
  labToOklch,
  lightnessOf,
  oklabToSrgb,
  oklchToHex,
  oklchToLab,
  parseColor,
  srgbToOklab,
  toHex,
  type Rgb,
} from '../../src/palette/ramp'

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps
const hueGap = (a: number, b: number) => {
  const d = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360))
  return Math.min(d, 360 - d)
}

describe('OKLab / OKLCH round trips', () => {
  it('oklch → lab → oklch is the identity', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const L of [0.12, 0.3, 0.5, 0.8, 0.97]) {
        for (const C of [0.01, 0.08, 0.18, 0.3]) {
          const [h, l, c] = labToOklch(oklchToLab(hue, L, C))
          expect(hueGap(h, hue)).toBeLessThan(1e-9)
          expect(l).toBeCloseTo(L, 12)
          expect(c).toBeCloseTo(C, 12)
        }
      }
    }
  })

  it('an achromatic colour has a defined hue of 0 and chroma 0', () => {
    expect(labToOklch([0.5, 0, 0])).toEqual([0, 0.5, 0])
  })

  it('srgb → oklab → srgb is the identity for in-gamut colours', () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
    for (const r of steps) for (const g of steps) for (const b of steps) {
      const back = oklabToSrgb(srgbToOklab([r, g, b]))
      for (let i = 0; i < 3; i++) expect(near(back[i], [r, g, b][i], 1e-6), `rgb(${r},${g},${b})`).toBe(true)
    }
  })

  it('reference values (Ottosson)', () => {
    const white = srgbToOklab([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 4)
    expect(Math.abs(white[1])).toBeLessThan(1e-4)
    expect(Math.abs(white[2])).toBeLessThan(1e-4)
    expect(srgbToOklab([0, 0, 0])[0]).toBeCloseTo(0, 6)
    const [h, L, C] = labToOklch(srgbToOklab([1, 0, 0]))
    expect(L).toBeCloseTo(0.628, 3)
    expect(C).toBeCloseTo(0.2577, 3)
    expect(h).toBeCloseTo(29.23, 1)
    // The spec's sunlit cream base: light, barely saturated.
    expect(lightnessOf(oklchToHex(85, 0.82, 0.05))).toBeCloseTo(0.82, 2)
  })
})

describe('gamut mapping', () => {
  it('pulls chroma in while holding lightness and hue', () => {
    for (const [hue, L, C] of [
      [140, 0.6, 0.4],
      [30, 0.5, 0.3],
      [260, 0.3, 0.25],
      [330, 0.85, 0.2],
    ]) {
      const rgb = oklabToSrgb(oklchToLab(hue, L, C))
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
      const [h, l, c] = labToOklch(srgbToOklab(rgb))
      expect(near(l, L, 0.01), `L ${L} → ${l}`).toBe(true)
      expect(hueGap(h, hue), `hue ${hue} → ${h}`).toBeLessThan(2)
      expect(c).toBeLessThan(C)
      expect(c).toBeGreaterThan(0.02)
    }
  })

  it('clamps what chroma reduction cannot fix (L outside 0..1)', () => {
    for (const c of oklabToSrgb([1.2, 0, 0])) expect(c).toBeCloseTo(1, 12)
    for (const c of oklabToSrgb([-0.1, 0, 0])) expect(c).toBeCloseTo(0, 12)
  })

  it('oklchToHex is lowercase #rrggbb, so the panel\'s colour equality check can rely on it', () => {
    for (let hue = 0; hue < 360; hue += 37) {
      const hex = oklchToHex(hue, 0.6, 0.12)
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      expect(oklchToHex(hue, 0.6, 0.12)).toBe(hex)
    }
  })
})

describe('colour strings', () => {
  it('parses the hex forms', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1])
    expect(parseColor('#FFFFFF')).toEqual([1, 1, 1])
    expect(parseColor('#00000080')).toEqual([0, 0, 0])
    expect(parseColor(' #abc ')).toEqual(parseColor('#aabbcc'))
    const rgb: Rgb = [0.2, 0.4, 0.6]
    const back = parseColor(toHex(rgb))
    for (let i = 0; i < 3; i++) expect(near(back[i], rgb[i], 1 / 255)).toBe(true)
  })

  it('parses oklch() as DialKit emits it', () => {
    const a = parseColor('oklch(0.6 0.1 30)')
    const b = parseColor('oklch(60% 0.1 30deg / 50%)')
    expect(a).toEqual(b)
    const [h, L, C] = labToOklch(srgbToOklab(a))
    expect(L).toBeCloseTo(0.6, 2)
    expect(C).toBeCloseTo(0.1, 2)
    expect(hueGap(h, 30)).toBeLessThan(1)
  })

  it('hex → oklch → hex is stable (the panel round trip)', () => {
    for (const hex of ['#1e2a44', '#d9c7b3', '#ff8800', '#808080', '#000000', '#ffffff']) {
      const [h, L, C] = labToOklch(srgbToOklab(parseColor(hex)))
      expect(oklchToHex(h, L, C)).toBe(hex)
    }
  })

  it('an unparseable string throws rather than returning garbage (no DOM here)', () => {
    expect(() => parseColor('not a colour')).toThrow()
  })
})

describe('buildRamp', () => {
  it('fills 256 opaque steps and holds the end stops', () => {
    const ramp = buildRamp(
      [
        { t: 0, color: '#000000' },
        { t: 1, color: '#ffffff' },
      ],
      'oklch',
    )
    expect(ramp.length).toBe(256 * 4)
    expect([ramp[0], ramp[1], ramp[2], ramp[3]]).toEqual([0, 0, 0, 255])
    expect([ramp[1020], ramp[1021], ramp[1022], ramp[1023]]).toEqual([255, 255, 255, 255])
    const mid = ramp[128 * 4]
    expect(mid).toBeGreaterThan(60)
    expect(mid).toBeLessThan(200)
  })

  it('needs two stops', () => {
    expect(() => buildRamp([{ t: 0, color: '#000000' }], 'srgb')).toThrow()
  })
})
