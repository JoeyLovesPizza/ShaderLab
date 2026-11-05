import { API_BASE, whenProbed } from './mode'

/*
 * Where a card's photo lives and how its `src` becomes a URL. In dev the
 * file is presets/photos/<id>.webp, written through the middleware and
 * served by Vite. The hosted build bundles whatever is in presets/photos/
 * at build time (the glob below) and keeps anything dropped in the
 * browser in IndexedDB, keyed by src, as a Blob: never a data URL in a
 * preset, and nothing lost on reload.
 */

const bundled = import.meta.glob('../../presets/photos/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>
const bundledBySrc = new Map(Object.entries(bundled).map(([path, url]) => [`photos/${path.replace(/^.*\//, '')}`, url]))

const DB = 'shaderlab-photos'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as Blob | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const objectUrls = new Map<string, string>()

/** The URL a photo `src` (photos/<id>.webp) is fetched from right now. */
export async function photoUrl(src: string): Promise<string> {
  const held = objectUrls.get(src)
  if (held) return held
  // A drop kept in the browser wins over the bundled file of the same name.
  const blob = await idbGet(src)
  if (blob) {
    const url = URL.createObjectURL(blob)
    objectUrls.set(src, url)
    return url
  }
  const asset = bundledBySrc.get(src)
  if (asset) return asset
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/presets/${src}`
}

/** The photo's bytes, for a sidecar download or an export. */
export async function photoBlob(src: string): Promise<Blob> {
  return (await fetch(await photoUrl(src))).blob()
}

/**
 * Keeps an encoded photo under its src: the file in dev (through the
 * middleware), IndexedDB in the hosted build. Either way the src is the
 * same, so a preset saved from either side points at the same name.
 */
export async function storePhoto(id: string, blob: Blob): Promise<string> {
  const src = `photos/${id}.webp`
  const old = objectUrls.get(src)
  if (old) {
    URL.revokeObjectURL(old)
    objectUrls.delete(src)
  }
  if (await whenProbed()) {
    await idbPut(src, blob)
    return src
  }
  const response = await fetch(`${API_BASE}/photos/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/webp' },
    body: blob,
  })
  if (!response.ok) throw new Error((await response.text().catch(() => '')) || response.statusText)
  // Dev keeps a copy in IndexedDB too, so the URL does not depend on
  // Vite having noticed the new file yet.
  await idbPut(src, blob).catch(() => undefined)
  return src
}
