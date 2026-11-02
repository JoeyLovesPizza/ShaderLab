import { useSyncExternalStore } from 'react'

/*
 * Where the app is running. With the dev server, saves and exports go
 * through its middleware into the repo. Hosted (GitHub Pages, or any
 * build), there is no middleware: saves download instead and the overlay
 * stays in localStorage. A build is static by definition; a dev session
 * probes once at startup in case the middleware is missing anyway.
 */

/** The dev middleware's root, respecting the app's base path. */
export const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/__shaderlab`

let isStatic = import.meta.env.PROD
let probed = import.meta.env.PROD
const listeners = new Set<() => void>()

async function probe() {
  try {
    const response = await fetch(`${API_BASE}/ping`, { method: 'HEAD' })
    isStatic = !response.ok
  } catch {
    isStatic = true
  }
  probed = true
  for (const l of listeners) l()
}

if (!probed) void probe()

export const getStaticMode = () => isStatic

/** Resolves once the probe has answered (at once in a build). */
export function whenProbed(): Promise<boolean> {
  if (probed) return Promise.resolve(isStatic)
  return new Promise((resolve) => {
    const stop = () => {
      listeners.delete(stop)
      resolve(isStatic)
    }
    listeners.add(stop)
  })
}

export function useStaticMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    getStaticMode,
  )
}
