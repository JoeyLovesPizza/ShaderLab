/*
 * OKLab / OKLCH maths, colour-string parsing and gamut mapping, written out
 * rather than taken from a library: it is forty lines, and the tonal rules
 * need the same conversions. The gradient-map ramp builder at the bottom is
 * kept from the earlier field shaders; `lights@1` does not use it.
 *
 * References: Björn Ottosson's OKLab (2020); sRGB transfer per IEC 61966-2-1.
 */

/** A `#rrggbb` stop on a ramp, 0..1 along it. */
export interface PaletteStop {
  t: number
  color: `#${string}`
}
export type PaletteSpace = 'oklch' | 'srgb'

/** 256 steps is plenty for an 8-bit output. */
export const RAMP_WIDTH = 256

/** The darkest a stop may be, in OKLCH L: navy, not black (SPEC.md §2, tonal rules). */
export const LUMINANCE_FLOOR = 0.18
/** The lightest stop must reach at least this: there is a light. */
export const LIGHT_FLOOR = 0.75
/** A pixel at or above this L counts as lit; the lit region must cover 35% of the card. */
export const LIT_THRESHOLD = 0.5
export const LIT_MIN_FRACTION = 0.35

export type Rgb = [number, number, number]
export type Lab = [number, number, number]

// ---- sRGB <-> linear <-> OKLab --------------------------------------------

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function toGamma(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export function srgbToOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Linear-light sRGB, possibly outside [0, 1]; `oklabToSrgb` clips. */
function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/**
 * OKLab to gamma sRGB, pulling chroma in until the colour fits the gamut
 * (lightness and hue kept), then clamping whatever is left. A plain clamp
 * shifts hue on saturated ramps; this keeps the ramp's intent.
 */
export function oklabToSrgb(lab: Lab): Rgb {
  const [L] = lab
  let [, a, b] = lab
  const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005)
  let rgb = oklabToLinear([L, a, b])
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      const candidate = oklabToLinear([L, lab[1] * mid, lab[2] * mid])
      if (inGamut(candidate)) lo = mid
      else hi = mid
    }
    a = lab[1] * lo
    b = lab[2] * lo
    rgb = oklabToLinear([L, a, b])
  }
  return rgb.map((c) => Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c)))))) as Rgb
}

// ---- OKLCH ------------------------------------------------------------------

/** OKLCH (hue in degrees, L, C) to OKLab. */
export function oklchToLab(hue: number, L: number, C: number): Lab {
  const h = (hue * Math.PI) / 180
  return [L, C * Math.cos(h), C * Math.sin(h)]
}

/** OKLab to OKLCH: [hue in degrees 0..360, L, C]. */
export function labToOklch([L, a, b]: Lab): [number, number, number] {
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return [hue, L, Math.hypot(a, b)]
}

/** OKLCH straight to a hex string, gamut-mapped. */
export function oklchToHex(hue: number, L: number, C: number): `#${string}` {
  return toHex(oklabToSrgb(oklchToLab(hue, L, C)))
}

// ---- Colour strings ----------------------------------------------------------

const HEX = /^#([0-9a-f]{3,8})$/i
const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/i

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa` and `oklch(L C H)` (the two formats
 * DialKit's colour control emits for a hex default) to gamma sRGB in 0..1.
 * Anything else goes through a 2D canvas, which normalises every CSS colour
 * the browser knows (Display P3 included, gamut-mapped) to hex.
 */
export function parseColor(input: string): Rgb {
  const value = input.trim()
  const hex = HEX.exec(value)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
  }
  const ok = OKLCH.exec(value)
  if (ok) {
    const L = ok[1].endsWith('%') ? parseFloat(ok[1]) / 100 : parseFloat(ok[1])
    const C = parseFloat(ok[2])
    const H = (parseFloat(ok[3]) * Math.PI) / 180
    return oklabToSrgb([L, C * Math.cos(H), C * Math.sin(H)])
  }
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error(`parseColor: cannot parse "${input}"`)
  ctx.fillStyle = '#000'
  ctx.fillStyle = value
  const normalised = String(ctx.fillStyle)
  if (!HEX.test(normalised)) throw new Error(`parseColor: cannot parse "${input}"`)
  return parseColor(normalised)
}

export function toHex([r, g, b]: Rgb): `#${string}` {
  const byte = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/** OKLCH lightness of a colour string, 0..1. */
export function lightnessOf(color: string): number {
  return srgbToOklab(parseColor(color))[0]
}

// ---- The ramp ---------------------------------------------------------------

function labToLch([L, a, b]: Lab): [number, number, number] {
  return [L, Math.hypot(a, b), Math.atan2(b, a)]
}

/** Shortest-arc hue interpolation; an achromatic end takes the other's hue. */
function mixLch(x: Lab, y: Lab, t: number): Lab {
  const [L1, C1, H1] = labToLch(x)
  const [L2, C2, H2] = labToLch(y)
  const L = L1 + (L2 - L1) * t
  const C = C1 + (C2 - C1) * t
  let h1 = H1
  let h2 = H2
  if (C1 < 1e-4) h1 = h2
  if (C2 < 1e-4) h2 = h1
  let d = h2 - h1
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  const H = h1 + d * t
  return [L, C * Math.cos(H), C * Math.sin(H)]
}

/** Stops sorted by `t`, without mutating the input. */
export function sortStops(stops: readonly PaletteStop[]): PaletteStop[] {
  return [...stops].sort((a, b) => a.t - b.t)
}

/**
 * Builds the gradient map. Left to right is field value 0 to 1; between two
 * stops the colour is interpolated in the palette's space, and outside the
 * first and last stops it holds their colour.
 */
export function buildRamp(stops: readonly PaletteStop[], space: PaletteSpace): Uint8ClampedArray {
  if (stops.length < 2) throw new Error('buildRamp: at least two stops')
  const sorted = sortStops(stops)
  const rgb = sorted.map((s) => parseColor(s.color))
  const lab = rgb.map(srgbToOklab)
  const out = new Uint8ClampedArray(RAMP_WIDTH * 4)

  for (let i = 0; i < RAMP_WIDTH; i++) {
    const t = i / (RAMP_WIDTH - 1)
    let k = 0
    while (k < sorted.length - 2 && t > sorted[k + 1].t) k++
    const a = sorted[k]
    const b = sorted[k + 1]
    const span = b.t - a.t
    const u = span <= 0 ? (t >= b.t ? 1 : 0) : Math.min(1, Math.max(0, (t - a.t) / span))

    let color: Rgb
    if (space === 'oklch') {
      color = oklabToSrgb(mixLch(lab[k], lab[k + 1], u))
    } else {
      color = rgb[k].map((c, ch) => c + (rgb[k + 1][ch] - c) * u) as Rgb
    }
    out[i * 4] = color[0] * 255
    out[i * 4 + 1] = color[1] * 255
    out[i * 4 + 2] = color[2] * 255
    out[i * 4 + 3] = 255
  }
  return out
}
