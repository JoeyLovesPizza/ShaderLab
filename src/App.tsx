import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { DialRoot, DialStore } from 'dialkit'
import { MotionConfig, useReducedMotion } from 'motion/react'
import 'dialkit/styles.css'
import { initialState, reduce, type BrowseView } from './states/machine'
import { stage } from './shader/stage'
import { clearDirty, getDirty, getDraft, revertToFile, setDraft, useDirtyPaths, useModified } from './model/cards'
import { getFamily } from './model/family'
import {
  cardById,
  duplicateCard,
  getCards,
  newCard,
  removeCard,
  renameCard,
  sourceOf,
  useCards,
  useSource,
} from './model/library'
import { newSeed, rollScoped, shuffle } from './model/shuffle'
import { deleteCardFile, saveCard } from './export/save'
import { exportAll, exportCards } from './export/exportAll'
import { useStaticMode } from './export/mode'
import { Browse } from './ui/Browse'
import { CardBoundary } from './ui/CardBoundary'
import { MassesPanel } from './ui/MassesPanel'
import { useFocusRect } from './ui/useFocusRect'
import type { CellFocus } from './ui/Cell'
import type { CardHandle } from './shader/handle'
import './App.css'

/*
 * The shell: header (name, Grid | Rail, New, Shuffle, the card menu, the
 * state, live numbers), Browse, the card panel, and DialKit's root. Focus
 * is not a separate view: the focused Cell flies out of Browse and brings
 * its own session (and hands the panel its live handle) with it. The
 * panel and the menu follow the active card: focused, else last hovered.
 */

const VIEWS: BrowseView[] = ['grid', 'rail']
/** The one DialKit panel's id (MassesPanel). */
const PANEL_ID = 'shaderlab-card'

function usePanelOpen() {
  return useSyncExternalStore(
    (notify) => DialStore.subscribePanelOpen(notify),
    () => DialStore.isPanelOpen(PANEL_ID),
  )
}

// Dev only: the app's own stores and stage for the console and for checks
// driven from outside. A dynamic import of the same files after an HMR
// update lands on a fresh module instance, not these.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __shaderlab: { stage, getDraft, setDraft, revertToFile, getFamily, getCards, cardById, shuffle },
  })
}

export default function App() {
  const [state, dispatch] = useReducer(reduce, initialState)
  const cards = useCards()
  // Hosted build: no middleware, so saves and exports download instead.
  const isStatic = useStaticMode()
  // The OS's reduce-motion setting freezes every card at its poster, as
  // the exported cards will on a visitor's machine. In the tool that reads
  // as "the animations don't work", so it is shown, with a way to play
  // anyway for this session.
  const osReduced = useReducedMotion() ?? false
  const [playAnyway, setPlayAnyway] = useState(false)
  const reduced = osReduced && !playAnyway
  const rect = useFocusRect()
  const statsRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState(() => cards[0]?.id ?? '')
  // The focused card's live handle, for the one panel below.
  const [handle, setHandle] = useState<CardHandle | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  // The panel's boundary: a throw inside it is reported here, and Reopen
  // mounts the panel afresh under a new key.
  const [panelError, setPanelError] = useState<string | null>(null)
  const [panelKey, setPanelKey] = useState(0)
  const panelOpen = usePanelOpen()

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

  // The card the menu and the panel act on: focused, else hovered, else the
  // last one touched; and never one that has left the library.
  const activePreset = cardById(focusedId ?? hoveredId ?? activeId) ?? cardById(activeId) ?? cards[0]
  // The stores answer an empty id with "nothing", so these can run on an
  // empty library too.
  const modified = useModified(activePreset?.id ?? '')
  const dirtyPaths = useDirtyPaths(activePreset?.id ?? '')
  const dirtyCount = dirtyPaths ? dirtyPaths.split(' ').length : 0
  const source = useSource(activePreset?.id ?? '')
  const unsaved = source === null || (source !== undefined && activePreset !== undefined && source !== activePreset.id)
  const targetId = () => activePreset?.id ?? ''

  // Shuffle: everything not dirty and not locked, with a new seed.
  // "Shuffle (all fields)" ignores dirty marks but still respects locks.
  // Shuffle all: every card, each with its own seed.
  const shuffleOne = (id: string, seed: number, ignoreDirty = false) => {
    const origin = cardById(id)
    if (!origin) return
    setDraft(id, rollScoped(origin, getDraft(id), getFamily(), seed, 'all', { dirty: getDirty(id), ignoreDirty }))
  }
  const onShuffle = () => shuffleOne(targetId(), newSeed())
  const onShuffleAllFields = () => shuffleOne(targetId(), newSeed(), true)
  const onClearEdits = () => {
    clearDirty(targetId())
    setNotice(`${activePreset?.meta.name}: hand edits unmarked (values kept)`)
  }
  const onShuffleAll = () => {
    const seeds = new Set<number>()
    for (const preset of cards) {
      let seed = newSeed()
      while (seeds.has(seed)) seed = newSeed()
      seeds.add(seed)
      shuffleOne(preset.id, seed)
    }
  }

  // The files are the truth: an edit or a shuffle is an overlay until it
  // is saved, and Revert drops it.
  const onRevert = () => {
    if (!activePreset) return
    revertToFile(activePreset.id)
    setNotice(`${activePreset.meta.name}: reverted to file`)
  }
  const onSave = async () => {
    if (!activePreset) return
    try {
      const path = await saveCard(activePreset)
      setNotice(`${activePreset.meta.name}: saved to ${path}`)
    } catch (err) {
      setNotice(`${activePreset.meta.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // --- Library -----------------------------------------------------------------
  const onNew = () => {
    const preset = newCard()
    setActiveId(preset.id)
    setNotice(`${preset.meta.name}: new card from the family (unsaved)`)
  }
  const onDuplicate = () => {
    if (!activePreset) return
    const copy = duplicateCard(activePreset.id)
    if (copy) {
      setActiveId(copy.id)
      setNotice(`${copy.meta.name}: duplicated (unsaved)`)
    }
  }
  const onRenameSubmit = (name: string) => {
    if (!activePreset) return
    const renamed = renameCard(activePreset.id, name)
    setRenaming(null)
    if (!renamed) return
    setActiveId(renamed.id)
    const moved = sourceOf(renamed.id) && sourceOf(renamed.id) !== renamed.id
    setNotice(`${renamed.meta.name}: renamed${moved ? `, the file moves to presets/${renamed.id}.json on Save` : ''}`)
  }
  const onDelete = async () => {
    if (!activePreset) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    const { id, meta } = activePreset
    const file = sourceOf(id)
    if (state.kind === 'Focus') dispatch({ type: 'escape' })
    try {
      if (file) await deleteCardFile(file)
      removeCard(id)
      setActiveId(getCards()[0]?.id ?? '')
      setNotice(`${meta.name}: deleted${isStatic || !file ? '' : ` (presets/${file}.json removed)`}`)
    } catch (err) {
      setNotice(`${meta.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const onExportOne = async () => {
    if (!activePreset) return
    setExporting(true)
    const lines = await exportCards([activePreset], {}, (line) => setNotice(`${line.id}: ${line.message}`))
    setExporting(false)
    setNotice(lines.every((l) => l.ok) ? `${activePreset.meta.name}: ${lines[0]?.message}` : `${activePreset.meta.name}: ${lines[0]?.message}`)
  }
  const onExportAll = async () => {
    setExporting(true)
    setNotice('Exporting…')
    const lines = await exportAll(cards, (line) => setNotice(`${line.id}: ${line.message}`))
    const failed = lines.filter((l) => !l.ok)
    setNotice(
      failed.length
        ? `Exported ${lines.length - failed.length} of ${lines.length}; failed: ${failed.map((l) => `${l.id} (${l.message})`).join(', ')}`
        : isStatic
          ? `Downloaded ${cards.length} PNGs, ${cards.length} presets and backgrounds.json`
          : `Exported ${cards.length} cards to out/ and handoff/backgrounds.json · npm run ship hands them to Portfolio`,
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
        <button type="button" className="pill" onClick={onNew} disabled={state.kind !== 'Browse'}>
          New
        </button>
        <button type="button" className="pill" onClick={onShuffle} disabled={!activePreset}>
          Shuffle
        </button>
        <details ref={menuRef} className="menu" onToggle={(e) => !e.currentTarget.open && setConfirmDelete(false)}>
          <summary className="pill">{activePreset ? `${activePreset.meta.name} …` : '…'}</summary>
          <div
            className="menu__items"
            onClick={(e) => {
              // An item closes the menu, except the first of Delete's two
              // clicks, which only arms it.
              const arming = (e.target as HTMLElement).closest('.menu__danger') && !confirmDelete
              if (!arming && menuRef.current) menuRef.current.open = false
            }}
          >
            <button type="button" onClick={() => setRenaming(activePreset?.meta.name ?? '')} disabled={!activePreset}>
              Rename
            </button>
            <button type="button" onClick={onDuplicate} disabled={!activePreset}>
              Duplicate
            </button>
            <button type="button" onClick={onExportOne} disabled={!activePreset || exporting}>
              {isStatic ? 'Download this card' : 'Export this card'}
            </button>
            <button type="button" onClick={onShuffleAllFields} disabled={!activePreset}>
              Shuffle (all fields)
            </button>
            <button type="button" onClick={onClearEdits} disabled={dirtyCount === 0}>
              Unmark hand edits
            </button>
            <button type="button" className="menu__danger" onClick={onDelete} disabled={!activePreset}>
              {confirmDelete ? 'Delete for good' : 'Delete…'}
            </button>
          </div>
        </details>
        <button type="button" className="pill" onClick={onShuffleAll} disabled={state.kind !== 'Browse'}>
          Shuffle all
        </button>
        <button type="button" className="pill" onClick={onRevert} disabled={!modified}>
          Revert to file
        </button>
        <button type="button" className="pill" onClick={onSave} disabled={!modified && !unsaved}>
          {isStatic ? 'Download preset' : 'Save to file'}
        </button>
        <button type="button" className="pill pill--primary" onClick={onExportAll} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export all'}
        </button>
        {renaming !== null && (
          <form
            className="rename"
            onSubmit={(e) => {
              e.preventDefault()
              onRenameSubmit(renaming)
            }}
          >
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
              aria-label="Card name"
            />
            <button type="submit" className="pill pill--primary">
              Rename
            </button>
            <button type="button" className="pill" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </form>
        )}
        <span className="bar__state">
          {state.kind}
          {state.kind === 'Browse' && ` · ${state.view}`}
          {state.kind === 'Focus' && state.exportOpen && ' · export'}
          {' · '}
          {activePreset?.meta.name ?? 'no cards'}
          {unsaved && <strong className="bar__modified"> · unsaved</strong>}
          {!unsaved && modified && <strong className="bar__modified"> · modified</strong>}
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
        {panelError ? (
          <button
            type="button"
            className="pill pill--primary bar__panel"
            title={panelError}
            onClick={() => {
              setPanelError(null)
              setPanelKey((k) => k + 1)
              DialStore.setPanelOpen(PANEL_ID, true)
            }}
          >
            Reopen panel
          </button>
        ) : (
          <button
            type="button"
            className="pill bar__panel"
            aria-pressed={panelOpen}
            onClick={() => DialStore.togglePanelOpen(PANEL_ID)}
          >
            {panelOpen ? 'Hide panel' : 'Show panel'}
          </button>
        )}
      </header>
      <main className="shell">
        <Browse
          view={view}
          presets={cards}
          reduced={reduced}
          focusedId={focusedId}
          focus={focus}
          onSelect={onSelect}
          onHover={onHover}
        />
      </main>
      {isStatic && (
        <footer className="foot">Hosted build: saves download instead of writing to the repo.</footer>
      )}
      {activePreset && (
        <CardBoundary
          key={panelKey}
          label="Card panel"
          fallback={() => null}
          onError={(message) => {
            setPanelError(message)
            setNotice(`Card panel failed: ${message}`)
          }}
        >
          <MassesPanel preset={activePreset} handle={focusedId ? handle : null} reduced={reduced} isStatic={isStatic} />
        </CardBoundary>
      )}
      <DialRoot position="top-right" />
    </MotionConfig>
  )
}
