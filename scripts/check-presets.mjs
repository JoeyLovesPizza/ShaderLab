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
const { validatePreset, validateFamily, describe } = await server.ssrLoadModule('/src/model/validate.ts')

const dir = resolve(root, 'presets')
let failed = 0
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
  } else console.log(`  ok    presets/${name}`)
}
await server.close()
if (failed) {
  console.error(`${failed} preset file(s) would load as flat cards`)
  process.exit(1)
}
