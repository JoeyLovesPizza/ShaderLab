import { packUniforms } from '../model/pack'
import type { CardDraft, Family, Preset } from '../model/types'
import type { UniformValues } from './massesManifest'
import { useSyncExternalStore } from 'react'
import { createRenderer, onShaderSource, type Renderer } from './renderer'

/*
 * The shared stage: one offscreen WebGL2 renderer that every card draws
 * through (SPEC.md §4, Thumbnails). A cell, the focused card and the PNG
 * export each hand it a `CardState` and a 2D canvas; it renders the frame
 * and blits it across. No cell owns a context, so the browser's context cap
 * never comes into it and a tab switch loses at most one.
 *
 * It also owns the clock. A target can be made live: the stage advances its
 * time each frame, draws it (capped at its fps) and blits. Usually one
 * target is live at a time (the hovered cell, or the focused card); the
 * loop runs only while something is.
 */

export interface CardState {
  uniforms: UniformValues
  loopSeconds: number
  fps: number
}

export function cardStateFrom(preset: Preset, draft: CardDraft, family: Family): CardState {
  const aspect = preset.canvas.width / preset.canvas.height
  return { uniforms: packUniforms(draft, family, aspect), loopSeconds: draft.loop.seconds, fps: preset.loop.fps }
}

export interface LiveOptions {
  /** Read each frame, so edits land without re-registering. */
  state: () => CardState
  /** Read each frame: 1 for a thumbnail or a card in flight, 2 settled. */
  dpr: () => number
  /** Starting playhead; defaults to the target's previous time, else 0. */
  time?: number
  playing?: boolean
  /** Draw-rate cap. Default 60. */
  fpsCap?: number
  /** After each draw, with the time drawn. For auras and the like. */
  onDraw?: (time: number) => void
}

interface LiveEntry {
  state: () => CardState
  dpr: () => number
  time: number
  playing: boolean
  fpsCap: number
  lastDraw: number
  onDraw?: (time: number) => void
}

export interface StageStats {
  /** Frames drawn in the last second, posters included. */
  fps: number
  /** JS time per frame, ms, averaged. */
  frameMs: number
  gpuMs: number | null
  /** Live targets right now. */
  live: number
}

const wrap = (t: number, loop: number) => ((t % loop) + loop) % loop

class Stage {
  private renderer: Renderer | null = null
  private live = new Map<HTMLCanvasElement, LiveEntry>()
  private raf: number | null = null
  private lastTick: number | null = null
  private listeners = new Set<(stats: StageStats) => void>()
  private stats = { frames: 0, drawMs: 0, since: 0 }
  /** Bumped whenever the shader program changes; posters key on it. */
  private version = 0
  private versionListeners = new Set<() => void>()

  constructor() {
    onShaderSource(() => {
      this.renderer?.dispose()
      this.renderer = null
      this.version += 1
      for (const l of this.versionListeners) l()
      for (const target of this.live.keys()) this.redraw(target)
    })
  }

  private ensure(): Renderer {
    if (!this.renderer) this.renderer = createRenderer(document.createElement('canvas'))
    return this.renderer
  }

  getVersion() {
    return this.version
  }

  subscribeVersion(listener: () => void) {
    this.versionListeners.add(listener)
    return () => {
      this.versionListeners.delete(listener)
    }
  }

  /**
   * Render one frame of `state` into `target` (a 2D canvas) at `dpr` times
   * its CSS size, or at `size` CSS px when given (export, or a canvas not
   * yet laid out).
   */
  renderInto(
    target: HTMLCanvasElement,
    state: CardState,
    time: number,
    dpr: number,
    size?: { width: number; height: number },
    quality: 'full' | 'half' = dpr >= 2 ? 'full' : 'half',
  ) {
    const r = this.ensure()
    const css = size ?? { width: target.clientWidth, height: target.clientHeight }
    const w = Math.max(1, Math.round(css.width * dpr))
    const h = Math.max(1, Math.round(css.height * dpr))
    const t0 = performance.now()

    r.resize(w, h, { grow: true })
    r.setUniforms(state.uniforms)
    r.draw({
      time: wrap(time, state.loopSeconds),
      loopSeconds: state.loopSeconds,
      fps: state.fps,
      // Thumbnails blur at half resolution; a focused card and export at full.
      blurScale: quality === 'full' ? 1 : 0.5,
    })

    if (target.width !== w) target.width = w
    if (target.height !== h) target.height = h
    const ctx = target.getContext('2d')
    if (!ctx) return
    const src = r.drawnRect()
    // Same task as the draw, so the drawing buffer is still there to copy
    // without preserveDrawingBuffer. 'copy', not source-over: a base with
    // alpha must replace the last frame, not stack on it.
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(r.canvas, src.x, src.y, src.width, src.height, 0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'

    this.stats.frames += 1
    this.stats.drawMs += performance.now() - t0
  }

  // --- Live targets ----------------------------------------------------------

  play(target: HTMLCanvasElement, options: LiveOptions) {
    const previous = this.live.get(target)
    this.live.set(target, {
      state: options.state,
      dpr: options.dpr,
      time: options.time ?? previous?.time ?? 0,
      playing: options.playing ?? true,
      fpsCap: options.fpsCap ?? 60,
      lastDraw: 0,
      onDraw: options.onDraw,
    })
    // A frame straight away, so a paused target isn't left blank.
    this.redraw(target)
    if (this.raf == null) {
      this.lastTick = null
      this.stats = { frames: 0, drawMs: 0, since: performance.now() }
      this.raf = requestAnimationFrame(this.tick)
    }
  }

  stop(target: HTMLCanvasElement) {
    this.live.delete(target)
    if (this.live.size === 0 && this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  has(target: HTMLCanvasElement) {
    return this.live.has(target)
  }

  getTime(target: HTMLCanvasElement): number | undefined {
    return this.live.get(target)?.time
  }

  isPlaying(target: HTMLCanvasElement) {
    return this.live.get(target)?.playing ?? false
  }

  setPlaying(target: HTMLCanvasElement, playing: boolean) {
    const e = this.live.get(target)
    if (e) e.playing = playing
  }

  /** Move a live target's playhead and draw that frame. */
  seek(target: HTMLCanvasElement, time: number) {
    const e = this.live.get(target)
    if (!e) return
    e.time = wrap(time, e.state().loopSeconds)
    this.redraw(target)
  }

  /** Draw a live target at its current time and dpr. */
  redraw(target: HTMLCanvasElement) {
    const e = this.live.get(target)
    if (!e || !target.isConnected) return
    this.renderInto(target, e.state(), e.time, e.dpr())
    e.onDraw?.(e.time)
  }

  /** Draw a live target at an exact time without moving its playhead. */
  renderAt(target: HTMLCanvasElement, time: number) {
    const e = this.live.get(target)
    if (!e || !target.isConnected) return
    this.renderInto(target, e.state(), time, e.dpr())
  }

  onStats(listener: (stats: StageStats) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const last = this.lastTick ?? now
    this.lastTick = now
    // Capped, so a backgrounded tab's gap doesn't jump the loop by minutes.
    const dt = Math.min(now - last, 100) / 1000

    for (const [target, e] of this.live) {
      if (!e.playing) continue
      const state = e.state()
      e.time = wrap(e.time + dt, state.loopSeconds)
      if (now - e.lastDraw < 1000 / e.fpsCap - 1.5) continue
      if (!target.isConnected) continue
      e.lastDraw = now
      this.renderInto(target, state, e.time, e.dpr())
      e.onDraw?.(e.time)
    }

    const s = this.stats
    if (now - s.since >= 1000) {
      const seconds = (now - s.since) / 1000
      const stats: StageStats = {
        fps: Math.round(s.frames / seconds),
        frameMs: s.frames ? s.drawMs / s.frames : 0,
        gpuMs: this.renderer?.gpuMs() ?? null,
        live: this.live.size,
      }
      this.stats = { frames: 0, drawMs: 0, since: now }
      for (const l of this.listeners) l(stats)
    }
  }
}

export const stage = new Stage()

/** The shader program's version, so a poster re-renders after a shader edit. */
export function useStageVersion(): number {
  return useSyncExternalStore(
    (l) => stage.subscribeVersion(l),
    () => stage.getVersion(),
  )
}
