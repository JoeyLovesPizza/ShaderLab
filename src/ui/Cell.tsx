import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { getDraft, useDirtyPaths, useDraft, useModified } from '../model/cards'
import { getFamily, useFamily } from '../model/family'
import { PRESET_ERRORS } from '../model/presets'
import { L_RANGE_MIN, type Preset } from '../model/types'
import { cardStateFrom, stage, useStageVersion } from '../shader/stage'
import { lRange, type LRange } from '../shader/range'
import type { CardHandle } from '../shader/handle'
import { FocusSession } from './FocusSession'
import type { Rect } from './useFocusRect'

/*
 * One preset in the Browse grid or rail, and, when selected, the focused
 * card itself. The same element plays all three parts: the card is a
 * Motion `layout` element that goes `position: fixed` when focused, so the
 * flight resizes the one canvas rather than swapping it for another
 * (SPEC.md §4, Gallery expand).
 *
 * Two canvases, stacked: the live one underneath, which the stage draws
 * into while hovered or focused, and the poster on top, holding the
 * `stillTime` frame. Hovering starts the loop at `stillTime`, the frame the
 * poster already shows, and hides the poster at once: nothing changes on
 * screen. Leaving freezes the live frame and crossfades the poster back in
 * only when the playhead has moved. The poster is keyed on a hash of
 * everything that goes into it (draft, family, shader version, size), so a
 * stale poster never sits beside a live loop. Both draws go through the
 * same stage at the same size and DPR, so the grain is pixel-identical.
 */

/** How the aura (and the Portfolio's glow) samples a card: 12 × 4. */
const AURA_COLS = 12
const AURA_ROWS = 4
/** The glow's cadence in Portfolio's VideoLoop. */
const AURA_INTERVAL_MS = 60

const CARD_RADIUS = 16
const CROSSFADE_MS = 350

/** The flight between cell and focus. */
const FLIGHT = { type: 'spring', visualDuration: 0.5, bounce: 0.12 } as const

export interface CellFocus {
  rect: Rect
  exportOpen: boolean
  onHandle: (handle: CardHandle | null) => void
  onExport: () => void
  onDone: () => void
  onClose: () => void
}

interface CellProps {
  preset: Preset
  /** Draw the approximate aura behind the card and the tonal check (the Rail). */
  aura?: boolean
  reduced: boolean
  /** Set while this cell is the focused card. */
  focus: CellFocus | null
  onSelect: (presetId: string) => void
  onHover: (presetId: string | null) => void
}

export function Cell({ preset, aura = false, reduced, focus, onSelect, onHover }: CellProps) {
  const draft = useDraft(preset.id)
  const modified = useModified(preset.id)
  const dirtyPaths = useDirtyPaths(preset.id)
  const family = useFamily()
  const shaderVersion = useStageVersion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const posterRef = useRef<HTMLCanvasElement>(null)
  const auraRef = useRef<HTMLCanvasElement>(null)
  const focused = focus !== null
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  // Landed in its focus box: render at DPR 2 from here. Under reduced
  // motion there is no flight, so it is settled at once.
  const [landed, setLanded] = useState(false)
  const settled = reduced || landed
  const lastAuraRef = useRef(0)
  // What the poster was last drawn from; a different hash means redraw.
  const posterKeyRef = useRef('')
  // The Rail's tonal check: the poster's L range (SPEC.md §2).
  const [range, setRange] = useState<LRange | null>(null)
  // A draw that threw (a shader that won't compile); shown under the card.
  const [renderError, setRenderError] = useState<string | null>(null)
  const loadError = PRESET_ERRORS.get(preset.id) ?? null

  const paintAura = useCallback((source: HTMLCanvasElement | null) => {
    const a = auraRef.current
    if (!a || !source) return
    a.getContext('2d')?.drawImage(source, 0, 0, AURA_COLS, AURA_ROWS)
  }, [])

  const showPoster = useCallback((fade: boolean) => {
    const p = posterRef.current
    if (!p) return
    p.style.transition = fade ? `opacity ${CROSSFADE_MS}ms ease` : 'none'
    p.style.opacity = '1'
  }, [])

  const hidePoster = useCallback(() => {
    const p = posterRef.current
    if (!p) return
    p.style.transition = 'none'
    p.style.opacity = '0'
  }, [])

  /** Draws the poster if anything it depends on has changed. */
  const drawPoster = useCallback(
    (force = false) => {
      const p = posterRef.current
      if (!p) return
      try {
        const state = cardStateFrom(preset, draft, family)
        const key = `${shaderVersion}|${p.clientWidth}x${p.clientHeight}|${preset.loop.stillTime}|${JSON.stringify(state)}`
        if (!force && key === posterKeyRef.current) return
        posterKeyRef.current = key
        stage.renderInto(p, state, preset.loop.stillTime, 1)
        if (aura) {
          paintAura(p)
          setRange(lRange(state, preset.loop.stillTime))
        }
        setRenderError(null)
      } catch (err) {
        setRenderError(err instanceof Error ? err.message : String(err))
      }
    },
    [preset, draft, family, shaderVersion, aura, paintAura],
  )

  // Poster whenever its inputs change, and when the cell is laid out at a
  // new size. Keyed, so a render with nothing new is skipped.
  useEffect(() => {
    drawPoster()
    const p = posterRef.current
    if (!p) return
    const observer = new ResizeObserver(() => drawPoster())
    observer.observe(p)
    return () => observer.disconnect()
  }, [drawPoster])

  // A cell unmounted mid-hover (switching Grid to Rail) must release its
  // canvas, or the stage keeps a dead entry live.
  useEffect(() => {
    const c = canvasRef.current
    return () => {
      if (c) stage.stop(c)
    }
  }, [])

  // Focus: the live canvas is the card. Leaving focus: the session has
  // released the canvas by the next frame; the poster comes back then,
  // crossfading since the loop will have moved on.
  useEffect(() => {
    if (focused) {
      setLanded(false)
      hidePoster()
      return
    }
    const id = requestAnimationFrame(() => {
      drawPoster()
      showPoster(true)
    })
    return () => cancelAnimationFrame(id)
  }, [focused, drawPoster, hidePoster, showPoster])

  const onEnter = () => {
    onHover(preset.id)
    const c = canvasRef.current
    if (!c || reduced || focusedRef.current || renderError || loadError) return
    try {
      // From stillTime: the first live frame is the poster's frame, so the
      // poster can go at once with nothing seen to change.
      stage.play(c, {
        state: () => cardStateFrom(preset, getDraft(preset.id), getFamily()),
        dpr: () => 1,
        time: preset.loop.stillTime,
        onDraw: aura
          ? () => {
              const now = performance.now()
              if (now - lastAuraRef.current < AURA_INTERVAL_MS) return
              lastAuraRef.current = now
              paintAura(c)
            }
          : undefined,
      })
      hidePoster()
    } catch (err) {
      stage.stop(c)
      setRenderError(err instanceof Error ? err.message : String(err))
    }
  }

  const onLeave = () => {
    onHover(null)
    const c = canvasRef.current
    if (!c || focusedRef.current) return
    // Freeze where the loop got to, then bring the poster back; a crossfade
    // only when the playhead actually moved off the poster's frame.
    const t = stage.getTime(c) ?? preset.loop.stillTime
    stage.stop(c)
    drawPoster()
    const loop = draft.loop.seconds
    const gap = Math.abs(((t - preset.loop.stillTime) % loop) + loop) % loop
    const moved = Math.min(gap, loop - gap) > 1 / preset.loop.fps
    showPoster(moved)
    if (aura) paintAura(posterRef.current)
  }

  const style: CSSProperties = focus
    ? {
        position: 'fixed',
        left: focus.rect.left,
        top: focus.rect.top,
        right: 'auto',
        bottom: 'auto',
        width: focus.rect.width,
        height: focus.rect.height,
        borderRadius: CARD_RADIUS,
      }
    : { borderRadius: CARD_RADIUS }

  const span = range ? range.max - range.min : null
  const low = span !== null && span < L_RANGE_MIN

  return (
    <div className={`cell-slot${aura ? ' cell-slot--aura' : ''}${focused ? ' is-focused' : ''}`}>
      {aura && (
        <canvas ref={auraRef} className="cell-aura" width={AURA_COLS} height={AURA_ROWS} aria-hidden />
      )}
      <motion.div
        className="cell"
        layout
        layoutId={`card-${preset.id}`}
        style={style}
        transition={FLIGHT}
        onLayoutAnimationStart={() => setLanded(false)}
        onLayoutAnimationComplete={() => setLanded(true)}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onClick={() => {
          if (!focusedRef.current) onSelect(preset.id)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !focusedRef.current) {
            e.preventDefault()
            onSelect(preset.id)
          }
        }}
        role="button"
        tabIndex={focused ? -1 : 0}
        aria-label={preset.meta.name}
      >
        <canvas ref={canvasRef} className="cell__canvas" />
        <canvas ref={posterRef} className="cell__canvas cell__poster" aria-hidden />
        {!focused && <span className="cell__name">{preset.meta.name}</span>}
        {!focused && modified && (
          <span className="cell__badge" title={dirtyPaths || undefined}>
            modified{dirtyPaths && <span className="cell__dot" aria-label="has hand edits" />}
          </span>
        )}
      </motion.div>
      {(loadError || renderError) && (
        <span className="cell__lit is-low" role="alert">
          {loadError ?? renderError}
        </span>
      )}
      {!loadError && !renderError && aura && range && span !== null && (
        <span className={`cell__lit${low ? ' is-low' : ''}`}>
          L {range.min.toFixed(2)}–{range.max.toFixed(2)} · range {span.toFixed(2)}
          {low ? ' · under 0.35' : ''} · seed {draft.seed} · {draft.modes.colour} / {draft.modes.coverage} /{' '}
          {draft.modes.structure}
        </span>
      )}
      {focus && (
        <FocusSession
          canvasRef={canvasRef}
          preset={preset}
          settled={settled}
          reduced={reduced}
          exportOpen={focus.exportOpen}
          onHandle={focus.onHandle}
          onExport={focus.onExport}
          onDone={focus.onDone}
          onClose={focus.onClose}
        />
      )}
    </div>
  )
}
