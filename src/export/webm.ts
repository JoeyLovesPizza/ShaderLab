import { ArrayBufferTarget, Muxer } from 'webm-muxer'
import type { Preset } from '../model/types'
import { stage, type CardState } from '../shader/stage'

/*
 * The WebM loop: every frame of the loop rendered at an exact time through
 * the stage (frame-exact by construction, unlike MediaRecorder), encoded
 * with WebCodecs as VP9 and muxed by webm-muxer. The first and last frames
 * join because the shader is periodic in the loop. Main thread, with a
 * breath between frames so the Export sheet can show progress; a worker
 * would need its own WebGL context and shader, which the stage does not
 * share. Chrome and Edge only: Safari and Firefox have no VideoEncoder.
 */

export interface WebmExportOptions {
  scale: number
  /** Called per encoded frame with progress 0 to 1, for the Export sheet. */
  onProgress?: (fraction: number) => void
}

const BITRATE = 6_000_000
const KEYFRAME_SECONDS = 2

/** True when this browser can run the WebCodecs path at all. */
export function canExportWebm(): boolean {
  return typeof VideoEncoder !== 'undefined'
}

export const WEBM_UNSUPPORTED = 'WebM needs Chrome or Edge (no VideoEncoder here)'

export async function exportWebm(preset: Preset, state: CardState, options: WebmExportOptions): Promise<Blob> {
  if (!canExportWebm()) throw new Error(WEBM_UNSUPPORTED)
  const width = preset.canvas.width * options.scale
  const height = preset.canvas.height * options.scale
  const fps = preset.loop.fps
  const frames = Math.max(1, Math.round(state.loopSeconds * fps))
  const config: VideoEncoderConfig = {
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: BITRATE,
    framerate: fps,
    latencyMode: 'quality',
  }
  const support = await VideoEncoder.isConfigSupported(config)
  if (!support.supported) throw new Error(`VP9 at ${width} × ${height} is not supported by this browser's encoder`)

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'V_VP9', width, height, frameRate: fps },
    firstTimestampBehavior: 'offset',
  })
  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      failure = err
    },
  })
  encoder.configure(config)

  const canvas = document.createElement('canvas')
  const frameUs = Math.round(1_000_000 / fps)
  const keyEvery = Math.max(1, Math.round(fps * KEYFRAME_SECONDS))
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure
    stage.renderInto(canvas, state, i / fps, 1, { width, height }, 'full')
    const frame = new VideoFrame(canvas, { timestamp: i * frameUs, duration: frameUs })
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 })
    frame.close()
    options.onProgress?.((i + 1) / frames)
    // Keep the encoder's queue short and let the sheet paint its progress.
    if (encoder.encodeQueueSize > 4) {
      await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
    } else if (i % 4 === 3) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/webm' })
}
