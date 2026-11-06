import type { Project } from './types'
import { describe, validateProject } from './validate'

/*
 * Every project file under presets/projects/, validated on load. Like
 * presets.ts, a file that is not JSON or does not validate never stops
 * the app: it is left out and its error is recorded (PROJECT_ERRORS), and
 * the backgrounds that named it get a project synthesized from themselves
 * (presets.ts). The files come in raw so a broken one is this module's
 * problem and not a Vite transform error over the whole page.
 */

const files = import.meta.glob('../../presets/projects/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** Load errors by file name; empty when every file validated. */
export const PROJECT_ERRORS: Map<string, string> = new Map()

function loadAll(): Project[] {
  const out: Project[] = []
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.replace(/^.*\//, '')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      PROJECT_ERRORS.set(file, `${file}: not JSON (${err instanceof Error ? err.message : String(err)})`)
      console.error(`[ShaderLab] presets/projects/${file} is not JSON:`, err)
      continue
    }
    const result = validateProject(json)
    if (!result.ok) {
      PROJECT_ERRORS.set(file, `${file}: ${describe(result.issues)}`)
      console.error(`[ShaderLab] presets/projects/${file} is invalid: ${describe(result.issues)}`)
      continue
    }
    if (result.value.id !== file.replace(/\.json$/, '')) {
      PROJECT_ERRORS.set(file, `${file}: id "${result.value.id}" does not match the filename`)
      console.error(`[ShaderLab] presets/projects/${file}: id "${result.value.id}" does not match the filename`)
      continue
    }
    for (const w of result.warnings) console.warn(`[ShaderLab] presets/projects/${file}: ${w.path}: ${w.message}`)
    out.push(result.value)
  }
  return out
}

/** The project files, alphabetical by filename. */
export const PROJECT_FILES: Project[] = loadAll()
