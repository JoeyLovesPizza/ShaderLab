import { draftOf, getDraft, markSaved } from '../model/cards'
import { markCardSaved, sourceOf, unmarkCardSaved } from '../model/library'
import type { Preset } from '../model/types'
import { validatePreset } from '../model/validate'
import { download } from './download'
import { API_BASE, whenProbed } from './mode'
import { presetFromCard, serializePreset } from './preset'

/*
 * "Save to file": the card's draft, over its preset, validated, written to
 * presets/<id>.json through the dev server's middleware (vite.config.ts).
 * A renamed card's old file is deleted once the new one is written, so a
 * rename moves the file. In a hosted build there is no writer, so the same
 * JSON downloads under the same name and the card stays unsaved, badge and
 * all, until Joe drops the file into the repo himself.
 */
export async function saveCard(preset: Preset): Promise<string> {
  const draft = getDraft(preset.id)
  const next = presetFromCard(preset, draft, { stillTime: draft.loop.stillTime, loopSeconds: draft.loop.seconds })
  const result = validatePreset(next)
  if (!result.ok) {
    throw new Error(`not saved: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)
  }
  const json = serializePreset(result.value)
  if (await whenProbed()) {
    download(new Blob([json], { type: 'application/json' }), `${preset.id}.json`)
    return `downloaded ${preset.id}.json (hosted build: drop it into presets/)`
  }
  // The card stands for its file from here, before the write, so the
  // file landing (and the library re-reading presets/) finds one card
  // with this id, not a file card beside an unsaved one.
  const source = sourceOf(preset.id) ?? null
  markSaved(preset.id, draftOf(result.value))
  markCardSaved(preset.id)
  let path: string
  try {
    const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(preset.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    })
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || response.statusText)
    path = ((await response.json()) as { path: string }).path
  } catch (err) {
    unmarkCardSaved(preset.id, source)
    throw err
  }
  if (source && source !== preset.id) {
    // The rename is complete only once the old file is gone.
    await fetch(`${API_BASE}/presets/${encodeURIComponent(source)}`, { method: 'DELETE' }).catch(() => undefined)
  }
  return path
}

/** Deletes the card's file (dev); hosted builds only forget the card. */
export async function deleteCardFile(id: string): Promise<void> {
  if (await whenProbed()) return
  const response = await fetch(`${API_BASE}/presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error(await response.text().catch(() => response.statusText))
}
