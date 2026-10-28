import { useState } from 'react'
import type { Preset } from '../model/types'
import type { CardHandle } from '../shader/handle'
import { exportPng } from '../export/png'
import { presetFromCard, serializePreset } from '../export/preset'
import { download } from '../export/download'
import { canExportWebm } from '../export/webm'
import { validatePreset } from '../model/validate'

/*
 * The Export sheet, over Focus (SPEC.md §6). Poster frame, loop length and
 * formats; Export writes the files the browser can give us (PNG at 2×, the
 * preset JSON), named `card-<project>`. WebM waits on the WebCodecs path.
 * Done closes the sheet with the card untouched: nothing here writes back
 * into the panel.
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
  const [status, setStatus] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const project = preset.meta.project ?? preset.id
  const webm = canExportWebm()

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
      if (png) {
        const blob = await exportPng(result.value, handle.getState(), { scale: 2, time: stillTime })
        download(blob, `card-${project}.png`)
        lines.push(`card-${project}.png (${result.value.canvas.width * 2} × ${result.value.canvas.height * 2})`)
      }
      if (json) {
        const blob = new Blob([serializePreset(result.value)], { type: 'application/json' })
        download(blob, `card-${project}.json`)
        lines.push(`card-${project}.json`)
      }
      lines.push(`Copy into Portfolio: cp ~/Downloads/card-${project}.* ../Portfolio/public/shaders/`)
    } catch (err) {
      lines.push(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
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
        <label className="is-disabled">
          <input type="checkbox" checked={false} disabled /> WebM loop
          <small>{webm ? 'WebCodecs is here; the encoder path lands tomorrow.' : 'No WebCodecs in this browser.'}</small>
        </label>
      </fieldset>
      {status.length > 0 && (
        <ul className="sheet__status">
          {status.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <div className="sheet__actions">
        <button type="button" className="pill" onClick={onDone}>
          Done
        </button>
        <button type="button" className="pill pill--primary" onClick={run} disabled={busy || (!png && !json)}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  )
}
