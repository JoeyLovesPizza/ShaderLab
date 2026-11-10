#!/usr/bin/env node
/*
 * npm run ship: hands the last "Export all" to the Portfolio.
 *   out/card-<id>.png      ->  Portfolio/public/work/shaders/card-<id>.webp  (via cwebp)
 *   out/card-<id>.webm     ->  Portfolio/public/work/shaders/card-<id>.webm and card-<id>.mp4 (via ffmpeg)
 *   out/photos/<id>.webp   ->  Portfolio/public/work/shaders/photos/<id>.webp
 *   out/<id>.json          ->  Portfolio/public/shaders/<id>.json
 *   handoff/backgrounds.json -> Portfolio/public/shaders/backgrounds.json
 * Portfolio is ../Portfolio unless SHADERLAB_PORTFOLIO names another folder
 * (absolute, or relative to the current directory): use it for a dry run.
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
const portfolio = process.env.SHADERLAB_PORTFOLIO ? resolve(process.env.SHADERLAB_PORTFOLIO) : resolve(root, '..', 'Portfolio')
const imgDir = resolve(portfolio, 'public', 'work', 'shaders')
const jsonDir = resolve(portfolio, 'public', 'shaders')
// A dry run into SHADERLAB_PORTFOLIO prints its real folder, so the log
// never claims Portfolio was written when it wasn't.
const label = process.env.SHADERLAB_PORTFOLIO ? `${portfolio}/` : 'Portfolio/'
const show = (p) => p.replace(`${portfolio}/`, label)

const files = (await readdir(out)).filter((f) => f.endsWith('.png') || f.endsWith('.json') || f.endsWith('.webm'))
// Photos exported alongside their cards, as they are (already WebP q88).
const photosDir = resolve(out, 'photos')
const photos = await readdir(photosDir).catch(() => [])
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

let hasFfmpeg = true
try {
  await run('ffmpeg', ['-version'])
} catch {
  hasFfmpeg = false
  console.warn('ffmpeg not found (brew install ffmpeg); WebM loops are copied without an MP4')
}

let count = 0
for (const file of files) {
  const src = resolve(out, file)
  if (file.endsWith('.json')) {
    const target = resolve(jsonDir, file)
    await copyFile(src, target)
    console.log(`${file}  ->  ${show(target)}`)
  } else if (file.endsWith('.webm')) {
    // The loop: the WebM as it is, plus an H.264 MP4 (faststart, no audio)
    // for Portfolio's VideoLoop, which QuickTime and Safari can play.
    const target = resolve(imgDir, file)
    await copyFile(src, target)
    console.log(`${file}  ->  ${show(target)}`)
    if (hasFfmpeg) {
      const mp4 = resolve(imgDir, file.replace(/\.webm$/, '.mp4'))
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', '-an', mp4])
      console.log(`${file}  ->  ${show(mp4)}`)
      count++
    }
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

for (const file of photos.filter((f) => f.endsWith('.webp'))) {
  const target = resolve(imgDir, 'photos', file)
  await mkdir(resolve(imgDir, 'photos'), { recursive: true })
  await copyFile(resolve(photosDir, file), target)
  console.log(`photos/${file}  ->  ${show(target)}`)
  count++
}

const manifest = resolve(root, 'handoff', 'backgrounds.json')
const manifestTarget = resolve(jsonDir, 'backgrounds.json')
await copyFile(manifest, manifestTarget)
console.log(`handoff/backgrounds.json  ->  ${show(manifestTarget)}`)

console.log(`${count + 1} files written`)
