import manifestSeed from '../../handoff/backgrounds.json'
import { getDraft, getLink } from '../model/cards'
import { getFamily } from '../model/family'
import type { Preset } from '../model/types'
import { validatePreset } from '../model/validate'
import { cardStateFrom, stage } from '../shader/stage'
import { download } from './download'
import { API_BASE, whenProbed } from './mode'
import { exportPng } from './png'
import { photoBlob } from './photoStore'
import { WEBM_UNSUPPORTED, canExportWebm, exportWebm } from './webm'
import { presetFromCard, serializePreset } from './preset'

/*
 * Export: a card's poster at 2× and its preset JSON. With the dev server
 * they are written into out/ through its middleware, and `npm run ship`
 * hands them to Portfolio. Hosted, each file downloads in turn with the
 * same names. Export all also regenerates handoff/backgrounds.json from
 * the library, with each card's mean colour as its `shadowColor`.
 */

export interface ExportLine {
  id: string
  ok: boolean
  message: string
}

interface Background {
  id: string
  name: string
  file: string
  preset: string
  shadowColor: string
  palette: string
  /** The loop as H.264 MP4, when a WebM was exported (ship.mjs transcodes it). */
  video?: string
  /** The card's photo, when it has one. */
  photo?: string
}

async function post(url: string, body: Blob | string, type: string): Promise<string> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || response.statusText)
  }
  const { path } = (await response.json()) as { path: string }
  return path
}

/** The poster's mean colour, as the aura will see it, from a small render. */
function meanColor(preset: Preset, time: number): string {
  const state = cardStateFrom(preset, getDraft(preset.id), getFamily())
  const canvas = document.createElement('canvas')
  stage.renderInto(canvas, state, time, 1, { width: 64, height: 43 }, 'half')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#808080'
  const { data } = ctx.getImageData(0, 0, 64, 43)
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const n = data.length / 4
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0').toUpperCase()
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function paletteNote(preset: Preset): string {
  const d = getDraft(preset.id)
  const base = d.base.value >= 0.6 ? 'light base' : d.base.value <= 0.35 ? 'dark base' : 'mid base'
  const structure = d.modes.structure === 'none' ? 'no structure' : d.modes.structure
  return `${base}, ${d.modes.colour} colour, ${d.modes.coverage} coverage, ${structure}, ${d.masses.length} masses`
}

export async function exportCards(
  presets: Preset[],
  options: { manifest?: boolean; webm?: boolean } = {},
  onProgress?: (line: ExportLine) => void,
): Promise<ExportLine[]> {
  const lines: ExportLine[] = []
  const isStatic = await whenProbed()
  const backgrounds: Background[] = []
  for (const preset of presets) {
    const draft = getDraft(preset.id)
    const line: ExportLine = { id: preset.id, ok: false, message: '' }
    try {
      const next = presetFromCard(preset, draft, { stillTime: draft.loop.stillTime, loopSeconds: draft.loop.seconds }, getLink(preset.id))
      const result = validatePreset(next)
      if (!result.ok) throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '))
      const state = cardStateFrom(preset, draft, getFamily())
      // The photo must be in the stage before the poster renders.
      if (draft.photo) await stage.ensurePhoto(draft.photo.src)
      const png = await exportPng(preset, state, { scale: 2, time: draft.loop.stillTime })
      const json = serializePreset(result.value)
      const size = `${preset.canvas.width * 2} × ${preset.canvas.height * 2}`
      if (isStatic) {
        download(png, `card-${preset.id}.png`)
        // A breath between two downloads, or a browser merges them.
        await new Promise((r) => setTimeout(r, 250))
        download(new Blob([json], { type: 'application/json' }), `${preset.id}.json`)
        await new Promise((r) => setTimeout(r, 250))
        line.message = `downloaded card-${preset.id}.png (${size}) and ${preset.id}.json`
      } else {
        const pngPath = await post(`${API_BASE}/export/${encodeURIComponent(preset.id)}/png`, png, 'image/png')
        const jsonPath = await post(`${API_BASE}/export/${encodeURIComponent(preset.id)}/json`, json, 'application/json')
        line.message = `${pngPath} (${size}), ${jsonPath}`
      }
      // The WebM loop, when asked for and the browser can encode it: the
      // slow part, so its progress goes out as it runs.
      if (options.webm) {
        if (!canExportWebm()) throw new Error(WEBM_UNSUPPORTED)
        const started = performance.now()
        const webm = await exportWebm(preset, state, {
          scale: 2,
          onProgress: (f) => onProgress?.({ id: preset.id, ok: true, message: `encoding WebM ${Math.round(f * 100)}%` }),
        })
        const took = `${((performance.now() - started) / 1000).toFixed(1)} s, ${(webm.size / 1_048_576).toFixed(1)} MB`
        if (isStatic) {
          download(webm, `card-${preset.id}.webm`)
          await new Promise((r) => setTimeout(r, 250))
          line.message += `, downloaded card-${preset.id}.webm (${took})`
        } else {
          const webmPath = await post(`${API_BASE}/export/${encodeURIComponent(preset.id)}/webm`, webm, 'video/webm')
          line.message += `, ${webmPath} (${took})`
        }
      }
      // The photo alongside: out/photos/<id>.webp (ship copies it over).
      if (draft.photo) {
        const blob = await photoBlob(draft.photo.src)
        if (isStatic) {
          download(blob, `${preset.id}.webp`)
          await new Promise((r) => setTimeout(r, 250))
          line.message += `, downloaded ${preset.id}.webp`
        } else {
          line.message += `, ${await post(`${API_BASE}/export/${encodeURIComponent(preset.id)}/photo`, blob, 'image/webp')}`
        }
      }
      backgrounds.push({
        id: preset.id,
        name: preset.meta.name,
        file: `/work/shaders/card-${preset.id}.webp`,
        preset: `/shaders/${preset.id}.json`,
        shadowColor: meanColor(preset, draft.loop.stillTime),
        palette: paletteNote(preset),
        ...(options.webm ? { video: `/work/shaders/card-${preset.id}.mp4` } : {}),
        ...(draft.photo ? { photo: `/work/shaders/photos/${preset.id}.webp` } : {}),
      })
      line.ok = true
    } catch (err) {
      line.message = err instanceof Error ? err.message : String(err)
    }
    lines.push(line)
    onProgress?.(line)
  }

  if (options.manifest) {
    const manifest = { readme: manifestSeed.readme, size: manifestSeed.size, backgrounds }
    const text = `${JSON.stringify(manifest, null, 2)}\n`
    const line: ExportLine = { id: 'backgrounds', ok: false, message: '' }
    try {
      if (isStatic) {
        download(new Blob([text], { type: 'application/json' }), 'backgrounds.json')
        line.message = 'downloaded backgrounds.json'
      } else {
        line.message = await post(`${API_BASE}/export/backgrounds`, text, 'application/json')
      }
      line.ok = true
    } catch (err) {
      line.message = err instanceof Error ? err.message : String(err)
    }
    lines.push(line)
    onProgress?.(line)
  }
  return lines
}

/** Export all: the whole library plus the manifest. */
export const exportAll = (presets: Preset[], onProgress?: (line: ExportLine) => void, webm = false) =>
  exportCards(presets, { manifest: true, webm }, onProgress)
