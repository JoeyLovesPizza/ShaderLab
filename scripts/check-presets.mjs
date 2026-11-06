// Runs the app's own validator over every file in presets/ (and the
// family), the way the app does on load, without a browser. A file that
// would load as a flat card fails this; a migration warning is printed
// and passes. Part of `npm run check`.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { middlewareMode: true }, logLevel: 'silent' })
const { validatePreset, validateProject, validateFamily, describe } = await server.ssrLoadModule('/src/model/validate.ts')

const dir = resolve(root, 'presets')
let failed = 0
const presetProjects = new Map()
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
  const json = JSON.parse(await readFile(resolve(dir, name), 'utf8'))
  const result = name === 'family.json' ? validateFamily(json) : validatePreset(json)
  for (const w of result.warnings ?? []) console.log(`  warn  presets/${name}: ${w.path}: ${w.message}`)
  if (!result.ok) {
    console.log(`  FAIL  presets/${name}: ${describe(result.issues)}`)
    failed++
  } else if (name !== 'family.json' && result.value.id !== name.replace(/\.json$/, '')) {
    console.log(`  FAIL  presets/${name}: id "${result.value.id}" does not match the filename`)
    failed++
  } else {
    if (name !== 'family.json') presetProjects.set(result.value.id, result.value.project)
    console.log(`  ok    presets/${name}`)
  }
}

// Projects: each file validates, its id matches the filename, its primary
// is a background that exists and belongs to it; every background's
// project has a file.
const projectsDir = resolve(dir, 'projects')
const projects = new Map()
for (const name of (await readdir(projectsDir).catch(() => [])).filter((n) => n.endsWith('.json')).sort()) {
  const json = JSON.parse(await readFile(resolve(projectsDir, name), 'utf8'))
  const result = validateProject(json)
  for (const w of result.warnings ?? []) console.log(`  warn  presets/projects/${name}: ${w.path}: ${w.message}`)
  if (!result.ok) {
    console.log(`  FAIL  presets/projects/${name}: ${describe(result.issues)}`)
    failed++
  } else if (result.value.id !== name.replace(/\.json$/, '')) {
    console.log(`  FAIL  presets/projects/${name}: id "${result.value.id}" does not match the filename`)
    failed++
  } else {
    projects.set(result.value.id, result.value)
    console.log(`  ok    presets/projects/${name}`)
  }
}
for (const [id, project] of projects) {
  if (presetProjects.get(project.primary) !== id) {
    console.log(`  FAIL  presets/projects/${id}.json: primary "${project.primary}" is not a background of this project`)
    failed++
  }
}
for (const [id, project] of presetProjects) {
  if (!projects.has(project)) {
    console.log(`  FAIL  presets/${id}.json: project "${project}" has no file in presets/projects/`)
    failed++
  }
}
await server.close()
if (failed) {
  console.error(`${failed} preset or project file(s) would load as flat cards or break a link`)
  process.exit(1)
}
