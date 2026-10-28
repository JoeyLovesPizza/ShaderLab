#!/usr/bin/env node
/*
 * npm run ship: copies the last "Export all" into the Portfolio.
 *   out/card-<id>.png  ->  ../Portfolio/public/work/shaders/
 *   out/<id>.json      ->  ../Portfolio/public/shaders/
 * Creates the folders, prints every file it copied, changes nothing else.
 * Run it when the cards are approved; the tool never ships on its own.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = resolve(root, 'out')
const portfolio = resolve(root, '..', 'Portfolio')
const pngDir = resolve(portfolio, 'public', 'work', 'shaders')
const jsonDir = resolve(portfolio, 'public', 'shaders')

const files = (await readdir(out)).filter((f) => f.endsWith('.png') || f.endsWith('.json'))
if (files.length === 0) {
  console.log('out/ holds no .png or .json: run Export all in ShaderLab first')
  process.exit(1)
}

await mkdir(pngDir, { recursive: true })
await mkdir(jsonDir, { recursive: true })

for (const file of files) {
  const target = resolve(file.endsWith('.png') ? pngDir : jsonDir, file)
  await copyFile(resolve(out, file), target)
  console.log(`${file}  ->  ${target.replace(`${portfolio}/`, 'Portfolio/')}`)
}
console.log(`${files.length} files copied`)
