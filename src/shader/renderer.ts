import * as masses from './masses'
import { UNIFORM_NAMES, defaultUniforms, specOf, type UniformValues } from './massesManifest'

/*
 * The WebGL2 side of a card, with no React in it: one context, three
 * programs (field, blur, final), one triangle, a few textures, and the
 * uniform values. A frame is the field pass into a texture, the Finish
 * blur passes when a blur is on (half resolution for thumbnails, full for
 * a focused card and export), and the final pass to the canvas. The stage
 * owns one of these offscreen and every card draws through it.
 */

/** Everything `draw` needs that isn't a manifest uniform. */
export interface FrameParams {
  /** Seconds, already wrapped into [0, loopSeconds). */
  time: number
  loopSeconds: number
  /** Frame rate the grain hash is keyed to, so the grain loops too. */
  fps: number
  /** Blur passes run at this fraction of the draw size. Default 1. */
  blurScale?: number
}

export interface Renderer {
  readonly gl: WebGL2RenderingContext
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  setUniforms(values: Partial<UniformValues>): void
  /**
   * Backing-store size in device pixels. With `grow`, the canvas only ever
   * gets bigger and the viewport is set to the requested size: a shared
   * offscreen renderer serving thumbnails and a focused card by turns would
   * otherwise reallocate its buffer every frame. The drawn region then sits
   * at the canvas's bottom-left (GL's origin); see `drawnRect`.
   */
  resize(width: number, height: number, options?: { grow?: boolean }): void
  /** Where the last draw landed in the canvas, in 2D-canvas coordinates. */
  drawnRect(): { x: number; y: number; width: number; height: number }
  draw(frame: FrameParams): void
  /**
   * GPU time of the most recent frame that has a result, in ms, or null when
   * the timer-query extension is missing. Polled, never blocking.
   */
  gpuMs(): number | null
  dispose(): void
}

interface TimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

/*
 * The shader source is taken through a live binding so an edit to
 * masses.ts reaches a renderer built later, and `onShaderSource` tells the
 * stage to rebuild the one it has: a poster drawn with the old program
 * beside a live loop drawn with the new one is a visible jump.
 */
type Sources = { VERT: string; FIELD_FRAG: string; BLUR_FRAG: string; FINAL_FRAG: string }
let sources: Sources = masses
const sourceListeners = new Set<() => void>()

export function onShaderSource(listener: () => void) {
  sourceListeners.add(listener)
  return () => {
    sourceListeners.delete(listener)
  }
}

if (import.meta.hot) {
  import.meta.hot.accept('./masses', (mod) => {
    if (!mod) return
    sources = mod as unknown as Sources
    for (const l of sourceListeners) l()
  })
}

const FIELD_FIXED = ['u_resolution', 'u_time', 'u_loopSeconds'] as const
const FINAL_FIXED = ['u_src', 'u_frame', 'u_grain', 'u_grainSeed', 'u_grainAnimate'] as const
const BLUR_FIXED = ['u_src', 'u_orig', 'u_texel', 'u_dir', 'u_lengthPx', 'u_sigmaPx', 'u_mode', 'u_intensity', 'u_seed'] as const

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed:\n${log}`)
  }
  return shader
}

interface Program {
  program: WebGLProgram
  loc: Map<string, WebGLUniformLocation | null>
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string, names: readonly string[]): Program {
  const program = gl.createProgram()
  if (!program) throw new Error('createProgram failed')
  const vs = compile(gl, gl.VERTEX_SHADER, vert)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed:\n${gl.getProgramInfoLog(program) ?? ''}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  const loc = new Map<string, WebGLUniformLocation | null>()
  for (const name of names) loc.set(name, gl.getUniformLocation(program, name))
  return { program, loc }
}

interface Target {
  texture: WebGLTexture
  fbo: WebGLFramebuffer
  width: number
  height: number
}

export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas): Renderer {
  // Alpha on, premultiplied: a base with alpha below 1 leaves the canvas
  // transparent there. No depth, no AA: the triangle has no edges.
  // preserveDrawingBuffer stays off; the stage blits in the same task.
  const context = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null
  if (!context) throw new Error('WebGL2 is not available')
  const gl: WebGL2RenderingContext = context

  const field = link(gl, sources.VERT, sources.FIELD_FRAG, [...UNIFORM_NAMES, ...FIELD_FIXED])
  const blur = link(gl, sources.VERT, sources.BLUR_FRAG, BLUR_FIXED)
  const final = link(gl, sources.VERT, sources.FINAL_FRAG, FINAL_FIXED)

  // One triangle that covers the clip-space square: no seam, one draw.
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  for (const p of [field, blur, final]) {
    const aPos = gl.getAttribLocation(p.program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
  }

  // Intermediate textures: half floats where the context can render to
  // them (the norm), eight-bit otherwise; OKLab is encoded into 0..1 either
  // way so the shaders don't care which.
  const floatOk = !!gl.getExtension('EXT_color_buffer_float')
  const makeTarget = (): Target => {
    const texture = gl.createTexture()
    const fbo = gl.createFramebuffer()
    if (!texture || !fbo) throw new Error('createTexture/Framebuffer failed')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return { texture, fbo, width: 0, height: 0 }
  }
  const fit = (t: Target, w: number, h: number) => {
    if (t.width === w && t.height === h) return
    gl.bindTexture(gl.TEXTURE_2D, t.texture)
    if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0)
    t.width = w
    t.height = h
  }
  const fieldTarget = makeTarget()
  const blurTargets = [makeTarget(), makeTarget(), makeTarget()]

  const values = defaultUniforms()
  let width = 0
  let height = 0

  // GPU timing: a small ring of queries, read back when available.
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null
  const pending: WebGLQuery[] = []
  let lastGpuMs: number | null = null

  function pollQueries() {
    if (!timer) return
    while (pending.length) {
      const q = pending[0]
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean
      if (!available) break
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
        lastGpuMs = ns / 1e6
      }
      gl.deleteQuery(q)
      pending.shift()
    }
  }

  function uploadFieldUniforms() {
    for (const name of UNIFORM_NAMES) {
      const l = field.loc.get(name)
      if (!l) continue
      const spec = specOf(name)
      const v = values[name]
      switch (spec.kind) {
        case 'float':
          if (typeof v === 'number') gl.uniform1f(l, v)
          break
        case 'int':
          if (typeof v === 'number') gl.uniform1i(l, Math.round(v))
          break
        case 'vec2':
          if (Array.isArray(v)) gl.uniform2fv(l, v)
          break
        case 'vec3':
          if (Array.isArray(v)) gl.uniform3fv(l, v)
          break
        case 'vec4':
          if (Array.isArray(v)) gl.uniform4fv(l, v)
          break
        case 'array':
          if (!Array.isArray(v)) break
          if (spec.components === 1) gl.uniform1fv(l, v)
          else if (spec.components === 2) gl.uniform2fv(l, v)
          else if (spec.components === 3) gl.uniform3fv(l, v)
          else gl.uniform4fv(l, v)
          break
      }
    }
  }

  const num = (name: keyof UniformValues) => {
    const v = values[name]
    return typeof v === 'number' ? v : 0
  }

  /** One blur pass from `src` (mixed with `orig`) into `out`. */
  function blurPass(
    src: Target,
    orig: Target,
    out: Target,
    mode: 0 | 1,
    dir: [number, number],
    lengthPx: number,
    sigmaPx: number,
    intensity: number,
  ) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
    gl.viewport(0, 0, out.width, out.height)
    gl.useProgram(blur.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, orig.texture)
    gl.uniform1i(blur.loc.get('u_src') ?? null, 0)
    gl.uniform1i(blur.loc.get('u_orig') ?? null, 1)
    gl.uniform2f(blur.loc.get('u_texel') ?? null, 1 / src.width, 1 / src.height)
    gl.uniform2f(blur.loc.get('u_dir') ?? null, dir[0], dir[1])
    gl.uniform1f(blur.loc.get('u_lengthPx') ?? null, lengthPx)
    gl.uniform1f(blur.loc.get('u_sigmaPx') ?? null, sigmaPx)
    gl.uniform1i(blur.loc.get('u_mode') ?? null, mode)
    gl.uniform1f(blur.loc.get('u_intensity') ?? null, intensity)
    gl.uniform1f(blur.loc.get('u_seed') ?? null, num('u_grainSeed'))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return {
    gl,
    canvas,
    setUniforms(next) {
      for (const name of UNIFORM_NAMES) {
        const v = next[name]
        if (v === undefined) continue
        const spec = specOf(name)
        if (spec.kind === 'float' || spec.kind === 'int') {
          if (typeof v === 'number' && Number.isFinite(v)) values[name] = v
        } else if (Array.isArray(v) && v.every(Number.isFinite)) {
          values[name] = [...v]
        }
      }
    },
    resize(w, h, options) {
      width = Math.max(1, Math.round(w))
      height = Math.max(1, Math.round(h))
      if (options?.grow) {
        if (canvas.width < width) canvas.width = width
        if (canvas.height < height) canvas.height = height
      } else {
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
      }
    },
    drawnRect() {
      return { x: 0, y: canvas.height - height, width, height }
    },
    draw({ time, loopSeconds, fps, blurScale = 1 }) {
      if (width === 0) return
      pollQueries()
      const q = timer && pending.length < 8 ? gl.createQuery() : null
      if (q && timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, q)

      // Field pass, into a texture.
      fit(fieldTarget, width, height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldTarget.fbo)
      gl.viewport(0, 0, width, height)
      gl.useProgram(field.program)
      uploadFieldUniforms()
      gl.uniform2f(field.loc.get('u_resolution') ?? null, width, height)
      gl.uniform1f(field.loc.get('u_time') ?? null, time)
      gl.uniform1f(field.loc.get('u_loopSeconds') ?? null, loopSeconds)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // Finish: the blur passes, in card widths turned into pixels of the
      // blur targets, which may be smaller than the draw.
      let result = fieldTarget
      const motionOn = num('u_motionOn') > 0.5 && num('u_motionLength') > 0
      const layerOn = num('u_layerOn') > 0.5 && num('u_layerRadius') > 0
      if (motionOn || layerOn) {
        const bw = Math.max(1, Math.round(width * blurScale))
        const bh = Math.max(1, Math.round(height * blurScale))
        for (const t of blurTargets) fit(t, bw, bh)
        if (motionOn) {
          const a = (num('u_motionAngle') * Math.PI) / 180
          blurPass(result, result, blurTargets[0], 0, [Math.cos(a), Math.sin(a)], num('u_motionLength') * bw, 0, num('u_motionIntensity'))
          result = blurTargets[0]
        }
        if (layerOn) {
          const sigma = (num('u_layerRadius') * bw) / 2
          blurPass(result, result, blurTargets[1], 1, [1, 0], 0, sigma, 1)
          blurPass(blurTargets[1], result, blurTargets[2], 1, [0, 1], 0, sigma, num('u_layerIntensity'))
          result = blurTargets[2]
        }
      }

      // Final pass, to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      gl.useProgram(final.program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, result.texture)
      gl.uniform1i(final.loc.get('u_src') ?? null, 0)
      gl.uniform1f(final.loc.get('u_frame') ?? null, Math.floor(time * fps))
      gl.uniform1f(final.loc.get('u_grain') ?? null, num('u_grain'))
      gl.uniform1f(final.loc.get('u_grainSeed') ?? null, num('u_grainSeed'))
      gl.uniform1f(final.loc.get('u_grainAnimate') ?? null, num('u_grainAnimate'))
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (q && timer) {
        gl.endQuery(timer.TIME_ELAPSED_EXT)
        pending.push(q)
      }
    },
    gpuMs() {
      pollQueries()
      return lastGpuMs
    },
    dispose() {
      for (const q of pending) gl.deleteQuery(q)
      pending.length = 0
      for (const t of [fieldTarget, ...blurTargets]) {
        gl.deleteFramebuffer(t.fbo)
        gl.deleteTexture(t.texture)
      }
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
      for (const p of [field, blur, final]) gl.deleteProgram(p.program)
      // Deliberately no loseContext(): a canvas keeps its one context for
      // life, and a renderer created on it again would compile against a
      // dead one.
    },
  }
}
