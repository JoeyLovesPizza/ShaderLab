import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { DialRoot } from 'dialkit'
import { MotionConfig, useReducedMotion } from 'motion/react'
import 'dialkit/styles.css'
import { initialState, reduce, type BrowseView } from './states/machine'
import { stage } from './shader/stage'
import { PRESETS, RAIL_PRESETS, presetById } from './model/presets'
import { clearDirty, getDirty, getDraft, revertToFile, setDraft, useDirtyPaths, useModified } from './model/cards'
import { getFamily } from './model/family'
import { newSeed, rollScoped, shuffle } from './model/shuffle'
import { saveCard } from './export/save'
import { exportAll } from './export/exportAll'
import { Browse } from './ui/Browse'
import { MassesPanel } from './ui/MassesPanel'
import { useFocusRect } from './ui/useFocusRect'
import type { CellFocus } from './ui/Cell'
import type { CardHandle } from './shader/handle'
import './App.css'

/*
 * The shell: header (name, Grid | Rail, Shuffle, the state, live numbers),
 * Browse, the card panel, and DialKit's root. Focus is not a separate
 * view: the focused Cell flies out of Browse and brings its own session
 * (and its own panel, bound to the live card) with it. In Browse the panel
 * follows the active card: the one last hovered, else the first.
 */

const VIEWS: BrowseView[] = ['grid', 'rail']

// Dev only: the app's own stores and stage for the console and for checks
// driven from outside. A dynamic import of the same files after an HMR
// update lands on a fresh module instance, not these.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __shaderlab: { stage, getDraft, setDraft, revertToFile, getFamily, PRESETS, RAIL_PRESETS, shuffle },
  })
}

export default function App() {
  const [state, dispatch] = useReducer(reduce, initialState)
  // The OS's reduce-motion setting freezes every card at its poster, as
  // the exported cards will on a visitor's machine. In the tool that reads
  // as "the animations don't work", so it is shown, with a way to play
  // anyway for this session.
  const osReduced = useReducedMotion() ?? false
  const [playAnyway, setPlayAnyway] = useState(false)
  const reduced = osReduced && !playAnyway
  const rect = useFocusRect()
  const statsRef = useRef<HTMLSpanElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState(PRESETS[0].id)
  // The focused card's live handle, for the one panel below.
  const [handle, setHandle] = useState<CardHandle | null>(null)

  useEffect(
    () =>
      stage.onStats(({ fps, frameMs, gpuMs, live }) => {
        const el = statsRef.current
        if (!el) return
        const gpu = gpuMs == null ? 'n/a' : `${gpuMs.toFixed(2)} ms`
        el.textContent = `${fps} fps · draw ${frameMs.toFixed(2)} ms · gpu ${gpu} · live ${live}`
      }),
    [],
  )

  // Step 3's single panel persisted under this key with a different shape;
  // left in place it would mask every code default below it.
  useEffect(() => {
    try {
      localStorage.removeItem('dialkit:shaderlab')
    } catch {
      // Storage can be blocked; nothing to migrate then.
    }
  }, [])

  const view = state.kind === 'Browse' ? state.view : state.returnTo
  const focusedId = state.kind === 'Focus' ? state.presetId : null
  const exportOpen = state.kind === 'Focus' && state.exportOpen

  const onSelect = useCallback((presetId: string) => {
    setActiveId(presetId)
    dispatch({ type: 'select', presetId })
  }, [])
  const onHover = useCallback((presetId: string | null) => {
    setHoveredId(presetId)
    if (presetId) setActiveId(presetId)
  }, [])
  const onExport = useCallback(() => dispatch({ type: 'export' }), [])
  const onDone = useCallback(() => dispatch({ type: 'done' }), [])
  const onClose = useCallback(() => dispatch({ type: 'escape' }), [])
  const focus = useMemo<CellFocus>(
    () => ({ rect, exportOpen, onHandle: setHandle, onExport, onDone, onClose }),
    [rect, exportOpen, onExport, onDone, onClose],
  )

  // Shuffle: the focused card, else the hovered one, else the active one,
  // with a new seed; everything not dirty and not locked. "Shuffle (all
  // fields)" ignores dirty marks but still respects locks. Shuffle all:
  // every card, each with its own seed.
  const shuffleOne = (id: string, seed: number, ignoreDirty = false) => {
    const preset = presetById(id)
    if (!preset) return
    setDraft(id, rollScoped(preset, getDraft(id), getFamily(), seed, 'all', { dirty: getDirty(id), ignoreDirty }))
  }
  const targetId = () => focusedId ?? hoveredId ?? activeId
  const onShuffle = () => shuffleOne(targetId(), newSeed())
  const onShuffleAllFields = () => shuffleOne(targetId(), newSeed(), true)
  const onClearEdits = () => {
    const id = targetId()
    clearDirty(id)
    setNotice(`${presetById(id)?.meta.name ?? id}: hand edits unmarked (values kept)`)
  }
  const onShuffleAll = () => {
    const seeds = new Set<number>()
    for (const preset of PRESETS) {
      let seed = newSeed()
      while (seeds.has(seed)) seed = newSeed()
      seeds.add(seed)
      shuffleOne(preset.id, seed)
    }
  }
  const activePreset = presetById(activeId) ?? PRESETS[0]
  const modified = useModified(activePreset.id)
  const dirtyPaths = useDirtyPaths(activePreset.id)
  const dirtyCount = dirtyPaths ? dirtyPaths.split(' ').length : 0
  const [notice, setNotice] = useState<string | null>(null)

  // The files are the truth: an edit or a shuffle is an overlay until it
  // is saved, and Revert drops it.
  const onRevert = () => {
    revertToFile(activePreset.id)
    setNotice(`${activePreset.meta.name}: reverted to file`)
  }
  const onSave = async () => {
    try {
      const path = await saveCard(activePreset)
      setNotice(`${activePreset.meta.name}: saved to ${path}`)
    } catch (err) {
      setNotice(`${activePreset.meta.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const [exporting, setExporting] = useState(false)
  const onExportAll = async () => {
    setExporting(true)
    setNotice('Exporting…')
    const lines = await exportAll(RAIL_PRESETS, (line) => setNotice(`${line.id}: ${line.message}`))
    const failed = lines.filter((l) => !l.ok)
    setNotice(
      failed.length
        ? `Exported ${lines.length - failed.length} of ${lines.length}; failed: ${failed.map((l) => `${l.id} (${l.message})`).join(', ')}`
        : `Exported ${lines.length} cards to out/ · npm run ship copies them into Portfolio`,
    )
    setExporting(false)
  }

  return (
    <MotionConfig reducedMotion="user">
      <header className="bar">
        <span className="bar__name">ShaderLab</span>
        <div className="segmented" role="group" aria-label="Browse view">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              disabled={state.kind !== 'Browse'}
              onClick={() => dispatch({ type: 'view', view: v })}
            >
              {v === 'grid' ? 'Grid' : 'Rail'}
            </button>
          ))}
        </div>
        <button type="button" className="pill" onClick={onShuffle}>
          Shuffle
        </button>
        <details className="menu">
          <summary className="pill">…</summary>
          <div className="menu__items">
            <button type="button" onClick={onShuffleAllFields}>
              Shuffle (all fields)
            </button>
            <button type="button" onClick={onClearEdits} disabled={dirtyCount === 0}>
              Unmark hand edits
            </button>
          </div>
        </details>
        <button type="button" className="pill" onClick={onShuffleAll} disabled={state.kind !== 'Browse'}>
          Shuffle all
        </button>
        <button type="button" className="pill" onClick={onRevert} disabled={!modified}>
          Revert to file
        </button>
        <button type="button" className="pill" onClick={onSave} disabled={!modified}>
          Save to file
        </button>
        <button type="button" className="pill pill--primary" onClick={onExportAll} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export all'}
        </button>
        <span className="bar__state">
          {state.kind}
          {state.kind === 'Browse' && ` · ${state.view}`}
          {state.kind === 'Focus' && state.exportOpen && ' · export'}
          {' · '}
          {activePreset.meta.name}
          {modified && <strong className="bar__modified"> · modified</strong>}
          {dirtyCount > 0 && (
            <span className="bar__dirty" title={dirtyPaths}>
              {' '}
              · {dirtyCount} by hand
            </span>
          )}
        </span>
        {osReduced && (
          <button
            type="button"
            className={`pill${playAnyway ? '' : ' pill--primary'}`}
            onClick={() => setPlayAnyway((p) => !p)}
            title="macOS Reduce Motion is on, so cards hold their poster frame; this plays them in the tool only"
          >
            {playAnyway ? 'Reduced motion: overridden' : 'Reduced motion is on · play anyway'}
          </button>
        )}
        {notice && <span className="bar__notice">{notice}</span>}
        <span ref={statsRef} className="bar__stats">
          idle
        </span>
      </header>
      <main className="shell">
        <Browse
          view={view}
          presets={PRESETS}
          railPresets={RAIL_PRESETS}
          reduced={reduced}
          focusedId={focusedId}
          focus={focus}
          onSelect={onSelect}
          onHover={onHover}
        />
      </main>
      {/* One panel, never remounted by a focus: the session hands it the
          live handle, and the transport wakes up. */}
      <MassesPanel preset={activePreset} handle={focusedId ? handle : null} reduced={reduced} />
      <DialRoot position="top-right" />
    </MotionConfig>
  )
}
