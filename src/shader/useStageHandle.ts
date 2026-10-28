import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { getDraft, setDraft, subscribeCards } from '../model/cards'
import { getFamily, subscribeFamily } from '../model/family'
import type { Preset } from '../model/types'
import type { CardHandle } from './handle'
import type { UniformValues } from './massesManifest'
import { cardStateFrom, stage, type CardState } from './stage'

/**
 * A `CardHandle` for the focused card, drawn through the shared stage into
 * the cell's own canvas, which is the same element it was in the grid: the
 * flight resizes it, nothing swaps it. `settled` picks the DPR: 1 while the
 * card is in flight, 2 once it has landed.
 *
 * The card's numbers live in the card store; this repacks the uniforms
 * whenever the draft or the family changes, and keeps the state deltas
 * (u_exposure, u_contrast) on top of them.
 */
export function useStageHandle(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  preset: Preset,
  settled: boolean,
  reduced: boolean,
): CardHandle {
  const stateRef = useRef<CardState>(cardStateFrom(preset, getDraft(preset.id), getFamily()))
  // The state deltas survive a repack.
  const deltasRef = useRef<Partial<UniformValues>>({})
  const settledRef = useRef(settled)
  settledRef.current = settled

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    stage.play(canvas, {
      state: () => stateRef.current,
      dpr: () => (settledRef.current ? 2 : 1),
      // Continue from wherever the hover left the playhead; a cold start
      // opens on the poster frame.
      time: stage.getTime(canvas) ?? preset.loop.stillTime,
      playing: !reduced,
    })
    return () => stage.stop(canvas)
  }, [canvasRef, preset, reduced])

  useEffect(() => {
    const repack = () => {
      stateRef.current = cardStateFrom(preset, getDraft(preset.id), getFamily())
      Object.assign(stateRef.current.uniforms, deltasRef.current)
      const canvas = canvasRef.current
      if (canvas && !stage.isPlaying(canvas)) stage.redraw(canvas)
    }
    const a = subscribeCards(repack)
    const b = subscribeFamily(repack)
    return () => {
      a()
      b()
    }
  }, [canvasRef, preset])

  // Landed: one frame at full DPR straight away rather than on the next tick.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && stage.has(canvas)) stage.redraw(canvas)
  }, [canvasRef, settled])

  return useMemo<CardHandle>(() => {
    const canvas = () => canvasRef.current
    const touch = () => {
      const c = canvas()
      if (c && !stage.isPlaying(c)) stage.redraw(c)
    }
    return {
      setUniforms(values) {
        Object.assign(deltasRef.current, values)
        Object.assign(stateRef.current.uniforms, values)
        touch()
      },
      setDraft(draft) {
        setDraft(preset.id, draft)
      },
      getDraft: () => getDraft(preset.id),
      play() {
        const c = canvas()
        if (c) stage.setPlaying(c, true)
      },
      pause() {
        const c = canvas()
        if (c) stage.setPlaying(c, false)
      },
      isPlaying() {
        const c = canvas()
        return c ? stage.isPlaying(c) : false
      },
      getTime() {
        const c = canvas()
        return (c && stage.getTime(c)) ?? 0
      },
      seek(seconds) {
        const c = canvas()
        if (c) stage.seek(c, seconds)
      },
      renderAt(seconds) {
        const c = canvas()
        if (c) stage.renderAt(c, seconds)
      },
      getState: () => stateRef.current,
    }
  }, [canvasRef, preset])
}
