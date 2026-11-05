import { useState } from 'react'
import type { Preset } from '../model/types'
import type { CardHandle } from '../shader/handle'
import { exportPng } from '../export/png'
import { presetFromCard, serializePreset } from '../export/preset'
import { download } from '../export/download'
import { WEBM_UNSUPPORTED, canExportWebm, exportWebm } from '../export/webm'
import { API_BASE, whenProbed } from '../export/mode'
import { validatePreset } from '../model/validate'
import { getFamily } from '../model/family'
import { cardStateFrom, stage } from '../shader/stage'

/*
 * The Export sheet, over Focus (SPEC.md §6). Poster frame, loop length and
 * formats; Export writes the files the browser can give us (PNG at 2×, the
 * preset JSON, the WebM loop), named `card-<id>`. PNG and JSON download;
 * the WebM goes to out/ through the dev server, and downloads in the
 * hosted build. Done closes the sheet with the card untouched: nothing
 * here writes back into the panel.
 */

interface ExportSheetProps {
  handle: CardHandle
  preset: Preset
  onDone: () => void
}

export function ExportSheet({ handle, preset, onDone }: ExportSheetProps) {
  const state = handle.getState()
  const [stillTime, setStillTime] = useState(preset.loop.stillTime)
  const [loopSeconds, setLoopSeconds] = useState(state.loopSeconds)
  const [png, setPng] = useState(true)
  const [json, setJson] = useState(true)
  const [webm, setWebm] = useState(false)
  const [status, setStatus] = useState<string[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const project = preset.meta.project ?? preset.id
  const webmOk = canExportWebm()

  const run = async () => {
    setBusy(true)
    const lines: string[] = []
    try {
      const next = presetFromCard(preset, handle.getDraft(), { stillTime, loopSeconds })
      const result = validatePreset(next)
      if (!result.ok) {
        lines.push('Not exported: the preset breaks a rule.')
        for (const issue of result.issues) lines.push(`${issue.path}: ${issue.message}`)
        setStatus(lines)
        return
      }
      // The idle state, whatever the switcher shows: the exported poster
      // never carries a hover or active lift.
      const idle = cardStateFrom(result.value, handle.getDraft(), getFamily())
      if (idle.photo) await stage.ensurePhoto(idle.photo.src)
      if (png) {
        const blob = await exportPng(result.value, idle, { scale: 2, time: stillTime })
        download(blob, `card-${project}.png`)
        lines.push(`card-${project}.png (${result.value.canvas.width * 2} × ${result.value.canvas.height * 2})`)
      }
      if (json) {
        const blob = new Blob([serializePreset(result.value)], { type: 'application/json' })
        download(blob, `card-${project}.json`)
        lines.push(`card-${project}.json`)
      }
      if (webm) {
        const started = performance.now()
        const blob = await exportWebm(result.value, { ...idle, loopSeconds }, {
          scale: 2,
          onProgress: (f) => setProgress(`Encoding WebM… ${Math.round(f * 100)}%`),
        })
        const seconds = ((performance.now() - started) / 1000).toFixed(1)
        const mb = (blob.size / 1_048_576).toFixed(1)
        if (await whenProbed()) {
          download(blob, `card-${project}.webm`)
          lines.push(`card-${project}.webm (${mb} MB, ${seconds} s)`)
        } else {
          const response = await fetch(`${API_BASE}/export/${encodeURIComponent(preset.id)}/webm`, {
            method: 'POST',
            headers: { 'Content-Type': 'video/webm' },
            body: blob,
          })
          if (!response.ok) throw new Error((await response.text().catch(() => '')) || response.statusText)
          const { path } = (await response.json()) as { path: string }
          lines.push(`${path} (${mb} MB, ${seconds} s)`)
        }
      }
      lines.push(`Copy into Portfolio: cp ~/Downloads/card-${project}.* ../Portfolio/public/shaders/`)
    } catch (err) {
      lines.push(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProgress(null)
      setStatus(lines)
      setBusy(false)
    }
  }

  return (
    <div className="sheet" role="dialog" aria-label="Export">
      <h2 className="sheet__title">Export {preset.meta.name}</h2>
      <label className="sheet__row">
        <span>Poster frame (s)</span>
        <input
          type="number"
          min={0}
          max={loopSeconds}
          step={0.1}
          value={stillTime}
          onChange={(e) => setStillTime(Number(e.target.value))}
        />
      </label>
      <label className="sheet__row">
        <span>Loop (s)</span>
        <input
          type="number"
          min={2}
          max={60}
          step={0.5}
          value={loopSeconds}
          onChange={(e) => setLoopSeconds(Number(e.target.value))}
        />
      </label>
      <fieldset className="sheet__formats">
        <legend>Formats</legend>
        <label>
          <input type="checkbox" checked={png} onChange={(e) => setPng(e.target.checked)} /> PNG at 2×
        </label>
        <label>
          <input type="checkbox" checked={json} onChange={(e) => setJson(e.target.checked)} /> Preset JSON
        </label>
        <label className={webmOk ? undefined : 'is-disabled'}>
          <input type="checkbox" checked={webm && webmOk} disabled={!webmOk} onChange={(e) => setWebm(e.target.checked)} /> WebM loop
          <small>{webmOk ? `VP9 at 2×, ${preset.loop.fps} fps, ${loopSeconds} s` : WEBM_UNSUPPORTED}</small>
        </label>
      </fieldset>
      {(status.length > 0 || progress) && (
        <ul className="sheet__status">
          {progress && <li>{progress}</li>}
          {status.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <div className="sheet__actions">
        <button type="button" className="pill" onClick={onDone}>
          Done
        </button>
        <button type="button" className="pill pill--primary" onClick={run} disabled={busy || (!png && !json && !webm)}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  )
}
