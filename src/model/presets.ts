import { PROJECT_FILES } from './projectFiles'
export { PROJECT_FILES }
import { deriveBackground } from './derive'
import { getFamily } from './family'
import { projectFromPreset } from './project'
import { CARD_MOTION_DEFAULT, blobMass, type Preset, type Project } from './types'
import { describe, validatePreset } from './validate'

/*
 * Every preset file under presets/, validated on load, in file order. The
 * library (library.ts) builds on this: cards added, renamed or removed in
 * a session sit over the files until they are saved. A file that fails
 * validation, or will not even parse, never stops the app: it loads as a
 * flat base-colour card carrying its error (PRESET_ERRORS), which the
 * cell shows under it. The files come in raw so a broken one is this
 * module's problem and not a Vite transform error over the whole page.
 *
 * In dev the module accepts its own updates: a file saved, added or
 * removed on disk re-reads the list and hands it to whoever listens
 * (the library), with no page reload. The listeners and the error map
 * live on hot.data so they survive the module being swapped.
 */

const files = import.meta.glob(['../../presets/*.json', '!**/family.json'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** A card from the family defaults alone, for a new card or a broken file. */
export function blankPreset(id: string, name: string): Preset {
  return {
    schema: 2,
    id,
    project: id,
    overrides: [],
    variation: null,
    shader: 'masses@1',
    canvas: { width: 613, height: 408, dpr: 2 },
    loop: { seconds: 12, fps: 30, stillTime: 6 },
    seed: 0,
    modes: { colour: 'mono', bold: false, coverage: 'blend', structure: 'none' },
    base: { hue: 0, value: 0.5, chroma: 0, locked: false },
    // One neutral mass, parked off the card: the schema wants at least one
    // and the panel's count slider starts at one.
    masses: [blobMass({ hue: 0, value: 0.5, chroma: 0, x: 1.5, y: 0.5, size: 0.4, softness: 0.8, distance: 0.8, locked: false })],
    texture: { grain: 0 },
    depth: {
      light: { on: true, height: 1.5 },
      curve: { on: false, amount: 0 },
      parallax: { on: false, amount: 0 },
      haze: { on: false, amount: 0 },
      swirl: { on: false, amount: 0, scale: 0.6 },
      relief: { on: false, amount: 0, frequency: 85, twist: 6 },
      strokes: { on: false, amount: 0.018, direction: 20, followAngle: true, size: 0.35, density: 14, taper: 0.25, chaos: 0, follow: 0.3, motion: 0.5 },
      shadow: { on: false, amount: 0, rect: [0, 0, 1, 1], offset: 0, spread: 0 },
    },
    motion: { ...CARD_MOTION_DEFAULT },
    finish: {
      motionBlur: { on: false, angle: 20, followAngle: true, length: 0.1, intensity: 0.6 },
      layerBlur: { on: false, radius: 0.04, intensity: 0.6 },
    },
    captionMask: false,
    image: null,
    photo: null,
    states: {
      idle: { uniforms: {}, loop: true },
      hover: { uniforms: { u_exposure: 0.08 }, transition: { duration: 0.3, ease: 'out', durationOut: 0.45 } },
      active: { uniforms: { u_exposure: 0.15, u_contrast: 0.9 }, transition: { duration: 0.6, ease: 'inOut', durationOut: 0.9 } },
    },
    meta: { name, created: new Date().toISOString().slice(0, 10) },
  }
}

function fallbackFor(path: string, json: unknown): Preset {
  const raw = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id ? raw.id : path.replace(/^.*\//, '').replace(/\.json$/, '')
  const meta = (typeof raw.meta === 'object' && raw.meta !== null ? raw.meta : {}) as Record<string, unknown>
  const preset = blankPreset(id, typeof meta.name === 'string' ? meta.name : id)
  preset.base.locked = true
  return preset
}

type HotData = { errors?: Map<string, string>; listeners?: Set<(presets: Preset[], projects: Project[]) => void> }
const hotData: HotData = import.meta.hot ? (import.meta.hot.data as HotData) : {}

/** Load errors by preset id; empty when every file validated. */
export const PRESET_ERRORS: Map<string, string> = (hotData.errors ??= new Map())
PRESET_ERRORS.clear()

function loadAll(): Preset[] {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      const file = path.replace(/^.*\//, '')
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch (err) {
        const preset = fallbackFor(path, null)
        PRESET_ERRORS.set(preset.id, `${file}: not JSON (${err instanceof Error ? err.message : String(err)})`)
        console.error(`[ShaderLab] presets/${file} is not JSON:`, err)
        return preset
      }
      const result = validatePreset(json)
      if (result.ok) {
        for (const w of result.warnings) console.warn(`[ShaderLab] presets/${file}: ${w.path}: ${w.message}`)
        return result.value
      }
      const preset = fallbackFor(path, json)
      PRESET_ERRORS.set(preset.id, `${file}: ${describe(result.issues)}`)
      console.error(`[ShaderLab] presets/${file} is invalid: ${describe(result.issues)}`)
      return preset
    })
}

/**
 * Each background resolved against its project, so what the app holds is
 * what renders. A background whose project file is missing (or broken)
 * gets one synthesized from itself, with a warning: nothing changes on
 * screen, and the next save writes the file.
 */
function resolveAll(presets: Preset[]): { presets: Preset[]; projects: Project[] } {
  const projects = new Map(PROJECT_FILES.map((p) => [p.id, p]))
  const synthesized: Project[] = []
  const resolved = presets.map((preset) => {
    // A broken file is a flat card carrying its error: leave it alone.
    if (PRESET_ERRORS.has(preset.id)) return preset
    let project = projects.get(preset.project)
    if (!project) {
      project = projectFromPreset(preset)
      console.warn(`[ShaderLab] presets/${preset.id}.json: project "${preset.project}" has no file; using one made from the card`)
      projects.set(project.id, project)
      synthesized.push(project)
    }
    return deriveBackground(preset, project, getFamily())
  })
  return { presets: resolved, projects: [...PROJECT_FILES, ...synthesized] }
}

const loaded = resolveAll(loadAll())

/** The file cards, in file order (alphabetical by filename). */
export const PRESETS: Preset[] = loaded.presets

/** Every project: the files, then any synthesized for a background. */
export const PROJECTS: Project[] = loaded.projects

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

const fileListeners = (hotData.listeners ??= new Set())

/** Dev only: the files were re-read after a change on disk. */
export function onPresetFiles(listener: (presets: Preset[], projects: Project[]) => void) {
  fileListeners.add(listener)
  return () => {
    fileListeners.delete(listener)
  }
}

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const next = mod as { PRESETS?: Preset[]; PROJECT_FILES?: Project[] } | undefined
    if (!next?.PRESETS) return
    for (const l of fileListeners) l(next.PRESETS, next.PROJECT_FILES ?? [])
  })
}
