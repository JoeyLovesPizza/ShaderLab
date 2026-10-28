import { getDraft, markSaved } from '../model/cards'
import type { Preset } from '../model/types'
import { validatePreset } from '../model/validate'
import { presetFromCard, serializePreset } from './preset'

/*
 * "Save to file": the card's draft, over its file, validated, written to
 * presets/<id>.json through the dev server's middleware (vite.config.ts).
 * Only the dev server answers; a build has no writer and the save says so.
 */
export async function saveCard(preset: Preset): Promise<string> {
  const draft = getDraft(preset.id)
  const next = presetFromCard(preset, draft, { stillTime: draft.loop.stillTime, loopSeconds: draft.loop.seconds })
  const result = validatePreset(next)
  if (!result.ok) {
    throw new Error(`not saved: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)
  }
  const response = await fetch(`/__shaderlab/presets/${encodeURIComponent(preset.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: serializePreset(result.value),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(response.status === 404 ? 'saving needs the dev server (vite serve)' : text || response.statusText)
  }
  const { path } = (await response.json()) as { path: string }
  markSaved(preset.id, draft)
  return path
}
