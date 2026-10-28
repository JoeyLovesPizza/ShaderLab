import { useEffect, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Preset } from '../model/types'
import type { CardHandle } from '../shader/handle'
import { useStageHandle } from '../shader/useStageHandle'
import { ExportSheet } from './ExportSheet'

/*
 * Everything that exists only while a card is focused (SPEC.md §6, Focus):
 * the handle that drives the cell's canvas through the stage, the chrome
 * (name, Export, Close) and the Export sheet. Rendered by the focused Cell
 * so the handle has its canvas; the chrome is portalled to the body so it
 * sits over the page. The panel itself stays in App and is handed the
 * handle through `onHandle`: remounting a panel of this size mid-flight
 * cost an 80 ms frame.
 */

interface FocusSessionProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  preset: Preset
  settled: boolean
  reduced: boolean
  exportOpen: boolean
  onHandle: (handle: CardHandle | null) => void
  onExport: () => void
  onDone: () => void
  onClose: () => void
}

export function FocusSession({
  canvasRef,
  preset,
  settled,
  reduced,
  exportOpen,
  onHandle,
  onExport,
  onDone,
  onClose,
}: FocusSessionProps) {
  const handle = useStageHandle(canvasRef, preset, settled, reduced)

  useEffect(() => {
    onHandle(handle)
    return () => onHandle(null)
  }, [handle, onHandle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return
      if (exportOpen) onDone()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportOpen, onDone, onClose])

  return createPortal(
    <>
      <div className="focus-backdrop" onClick={onClose} aria-hidden />
      <div className="focus-chrome">
        <span className="focus-chrome__name">{preset.meta.name}</span>
        <button type="button" className="pill" onClick={onExport}>
          Export
        </button>
        <button type="button" className="pill pill--icon" onClick={onClose} aria-label="Back to browse">
          ×
        </button>
      </div>
      {exportOpen && <ExportSheet handle={handle} preset={preset} onDone={onDone} />}
    </>,
    document.body,
  )
}
