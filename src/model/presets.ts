import type { Preset } from './types'
import { describe, validatePreset } from './validate'

/*
 * Every preset file under presets/masses/, validated on load, in the
 * Portfolio's carousel order (SPEC.md §6, Rail). A file that fails
 * validation never stops the app: it loads as a flat base-colour card
 * carrying its error (PRESET_ERRORS), which the cell shows under it.
 */

const CAROUSEL_ORDER = ['wildflower', 'human-in-the-loop', 'dash', 'dropbox-meetings', 'paper', 'showreel']

const files = import.meta.glob('../../presets/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

/** What a broken file renders as: the base alone, mid grey. */
function fallbackFor(path: string, json: unknown): Preset {
  const raw = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id ? raw.id : path.replace(/^.*\//, '').replace(/\.json$/, '')
  const meta = (typeof raw.meta === 'object' && raw.meta !== null ? raw.meta : {}) as Record<string, unknown>
  return {
    schema: 2,
    id,
    shader: 'masses@1',
    canvas: { width: 613, height: 408, dpr: 2 },
    loop: { seconds: 24, fps: 30, stillTime: 6 },
    seed: 0,
    modes: { colour: 'mono', bold: false, coverage: 'flat', structure: 'none' },
    base: { hue: 0, value: 0.5, chroma: 0, locked: true },
    masses: [],
    texture: { grain: 0 },
    depth: {
      curve: { on: false, amount: 0 },
      parallax: { on: false, amount: 0 },
      haze: { on: false, amount: 0 },
      swirl: { on: false, amount: 0 },
      relief: { on: false, amount: 0, frequency: 60, twist: 6 },
      shadow: { on: false, amount: 0, rect: [0, 0, 1, 1], offset: 0, spread: 0 },
    },
    finish: {
      motionBlur: { on: false, angle: 20, followAngle: true, length: 0.1, intensity: 0.6 },
      layerBlur: { on: false, radius: 0.04, intensity: 0.6 },
    },
    captionMask: false,
    image: null,
    meta: { name: typeof meta.name === 'string' ? meta.name : id, created: '' },
  }
}

/** Load errors by preset id; empty when every file validated. */
export const PRESET_ERRORS = new Map<string, string>()

const loaded: Preset[] = Object.entries(files)
  .filter(([path]) => !path.endsWith('/family.json'))
  .map(([path, json]) => {
    const result = validatePreset(json)
    const file = path.replace(/^.*\//, '')
    if (result.ok) return result.value
    const preset = fallbackFor(path, json)
    PRESET_ERRORS.set(preset.id, `${file}: ${describe(result.issues)}`)
    console.error(`[ShaderLab] presets/${file} is invalid: ${describe(result.issues)}`)
    return preset
  })

const rank = (preset: Preset) => {
  const i = CAROUSEL_ORDER.indexOf(preset.id)
  return i < 0 ? CAROUSEL_ORDER.length : i
}

export const PRESETS: Preset[] = loaded.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))

/** The six carousel cards only, for the Rail. */
export const RAIL_PRESETS: Preset[] = PRESETS.filter((p) => CAROUSEL_ORDER.includes(p.id))

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
