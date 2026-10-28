import { getDraft } from '../model/cards'
import { getFamily } from '../model/family'
import type { Preset } from '../model/types'
import { validatePreset } from '../model/validate'
import { cardStateFrom } from '../shader/stage'
import { exportPng } from './png'
import { presetFromCard, serializePreset } from './preset'

/*
 * Export all: every card's poster at 2× and its preset JSON, written into
 * out/ through the dev server's middleware (vite.config.ts), no browser
 * downloads. `npm run ship` then copies out/ into Portfolio.
 */

export interface ExportLine {
  id: string
  ok: boolean
  message: string
}

async function post(url: string, body: Blob | string, type: string): Promise<string> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(response.status === 404 ? 'exporting needs the dev server (vite serve)' : text || response.statusText)
  }
  const { path } = (await response.json()) as { path: string }
  return path
}

export async function exportAll(presets: Preset[], onProgress?: (line: ExportLine) => void): Promise<ExportLine[]> {
  const lines: ExportLine[] = []
  for (const preset of presets) {
    const draft = getDraft(preset.id)
    const line: ExportLine = { id: preset.id, ok: false, message: '' }
    try {
      const next = presetFromCard(preset, draft, { stillTime: draft.loop.stillTime, loopSeconds: draft.loop.seconds })
      const result = validatePreset(next)
      if (!result.ok) throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '))
      const state = cardStateFrom(preset, draft, getFamily())
      const png = await exportPng(preset, state, { scale: 2, time: draft.loop.stillTime })
      const pngPath = await post(`/__shaderlab/export/${encodeURIComponent(preset.id)}/png`, png, 'image/png')
      const jsonPath = await post(
        `/__shaderlab/export/${encodeURIComponent(preset.id)}/json`,
        serializePreset(result.value),
        'application/json',
      )
      line.ok = true
      line.message = `${pngPath} (${preset.canvas.width * 2} × ${preset.canvas.height * 2}), ${jsonPath}`
    } catch (err) {
      line.message = err instanceof Error ? err.message : String(err)
    }
    lines.push(line)
    onProgress?.(line)
  }
  return lines
}
