import { getDraft, markDirty, setDraft } from '../model/cards'
import { extractPalette } from '../model/extract'
import { getFamily } from '../model/family'
import { PHOTO_HEIGHT, PHOTO_WIDTH } from '../model/photo'
import { stage } from '../shader/stage'
import { storePhoto } from './photoStore'

/*
 * A photo dropped onto a card (SPEC.md §4, Photo stage): decoded,
 * cover-fitted to the card's 1226 × 816, encoded as WebP q88, kept under
 * presets/photos/<id>.webp (dev) or in the browser (hosted), and set on
 * the card at fidelity 0.5. The palette extracted from it becomes the
 * card's base and masses, dirty-marked so a shuffle leaves them alone.
 */

const DOWNSAMPLE = { width: 64, height: 43 }

export async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Some encodings (a Retina screenshot's colour profile, HEIC on
    // Safari) decode through an <img> where createImageBitmap balks.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return await createImageBitmap(img)
    } catch (err) {
      throw new Error(`could not decode the image (${err instanceof Error ? err.message : String(err)})`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export function coverFit(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PHOTO_WIDTH
  canvas.height = PHOTO_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D context')
  const scale = Math.max(PHOTO_WIDTH / image.width, PHOTO_HEIGHT / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, (PHOTO_WIDTH - w) / 2, (PHOTO_HEIGHT - h) / 2, w, h)
  return canvas
}

function encodeWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('WebP encoding failed'))), 'image/webp', 0.88)
  })
}

/** A small, soft copy (two downscales, near the W/22 level) for k-means. */
export function softDownsample(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const mid = document.createElement('canvas')
  mid.width = 22
  mid.height = 15
  const mctx = mid.getContext('2d')!
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(canvas, 0, 0, mid.width, mid.height)
  const small = document.createElement('canvas')
  small.width = DOWNSAMPLE.width
  small.height = DOWNSAMPLE.height
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(mid, 0, 0, DOWNSAMPLE.width, DOWNSAMPLE.height)
  return sctx.getImageData(0, 0, DOWNSAMPLE.width, DOWNSAMPLE.height).data
}

export interface PhotoImport {
  src: string
  extracted: { base: string; masses: number }
}

export async function importPhoto(cardId: string, file: Blob, aspect = PHOTO_WIDTH / PHOTO_HEIGHT): Promise<PhotoImport> {
  const image = await decode(file)
  const fitted = coverFit(image)
  image.close()
  const blob = await encodeWebp(fitted)
  const src = await storePhoto(cardId, blob)
  stage.forgetPhoto(src)

  const draft = structuredClone(getDraft(cardId))
  const family = getFamily()
  const { base, masses } = extractPalette(softDownsample(fitted), DOWNSAMPLE.width, DOWNSAMPLE.height, family, aspect)
  draft.photo = { src, fidelity: 0.5 }
  draft.base = base
  if (masses.length) draft.masses = masses
  // The photo carries the picture: the swirl's warp is clamped by the
  // shader, strokes lean on the photo's own gradient, and a strong stroke
  // amount would fight it (SPEC.md §4).
  if (draft.depth.strokes.on && draft.depth.strokes.amount > 0.02) draft.depth.strokes.amount = 0.02
  setDraft(cardId, draft)
  const paths = ['base.hue', 'base.value', 'base.chroma']
  masses.forEach((_, i) => paths.push(`masses.${i}.hue`, `masses.${i}.value`, `masses.${i}.chroma`, `masses.${i}.x`, `masses.${i}.y`, `masses.${i}.size`))
  markDirty(cardId, paths)
  void stage.ensurePhoto(src)
  return { src, extracted: { base: `${base.hue}/${base.value}/${base.chroma}`, masses: masses.length } }
}

export function removePhoto(cardId: string) {
  const draft = structuredClone(getDraft(cardId))
  draft.photo = null
  setDraft(cardId, draft)
}
