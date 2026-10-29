#!/usr/bin/env node
/*
 * npm run ship: hands the last "Export all" to the Portfolio.
 *   out/card-<id>.png      ->  Portfolio/public/work/shaders/card-<id>.webp  (via cwebp)
 *   out/<id>.json          ->  Portfolio/public/shaders/<id>.json
 *   handoff/backgrounds.json -> Portfolio/public/shaders/backgrounds.json
 * Creates the folders, prints every file it wrote, touches nothing under
 * Portfolio/src. The component and CSS stay in handoff/; an agent copies them
 * in by hand following handoff/README.md.
 *
 * WebP because the PNGs are ~1.9 MB each (grain compresses badly lossless)
 * and the WebPs at q88 are ~180 KB with the grain intact. Needs cwebp on PATH
 * (brew install webp); without it the PNG is copied as-is and a warning says so.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const out = resolve(root, 'out')
const portfolio = resolve(root, '..', 'Portfolio')
const imgDir = resolve(portfolio, 'public', 'work', 'shaders')
const jsonDir = resolve(portfolio, 'public', 'shaders')
const show = (p) => p.replace(`${portfolio}/`, 'Portfolio/')

const files = (await readdir(out)).filter((f) => f.endsWith('.png') || f.endsWith('.json'))
if (files.length === 0) {
  console.log('out/ holds no .png or .json: run Export all in ShaderLab first')
  process.exit(1)
}

await mkdir(imgDir, { recursive: true })
await mkdir(jsonDir, { recursive: true })

let hasCwebp = true
try {
  await run('cwebp', ['-version'])
} catch {
  hasCwebp = false
  console.warn('cwebp not found (brew install webp); copying PNGs instead of WebP')
}

let count = 0
for (const file of files) {
  const src = resolve(out, file)
  if (file.endsWith('.json')) {
    const target = resolve(jsonDir, file)
    await copyFile(src, target)
    console.log(`${file}  ->  ${show(target)}`)
  } else if (hasCwebp) {
    const target = resolve(imgDir, file.replace(/\.png$/, '.webp'))
    await run('cwebp', ['-quiet', '-q', '88', '-m', '6', src, '-o', target])
    console.log(`${file}  ->  ${show(target)}`)
  } else {
    const target = resolve(imgDir, file)
    await copyFile(src, target)
    console.log(`${file}  ->  ${show(target)}`)
  }
  count++
}

const manifest = resolve(root, 'handoff', 'backgrounds.json')
const manifestTarget = resolve(jsonDir, 'backgrounds.json')
await copyFile(manifest, manifestTarget)
console.log(`handoff/backgrounds.json  ->  ${show(manifestTarget)}`)

console.log(`${count + 1} files written`)
