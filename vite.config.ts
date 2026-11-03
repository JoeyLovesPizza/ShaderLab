import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

/*
 * "Save to file", dev server only: POST /__shaderlab/presets/<id> with the
 * preset as JSON writes presets/<id>.json, pretty-printed with sorted keys,
 * so Joe's tuning lands in git-tracked files rather than localStorage.
 * `apply: 'serve'` keeps it out of every build; the id is a strict slug and
 * the body must carry the same id, so nothing can write outside presets/.
 */
const SLUG = /^[a-z0-9][a-z0-9-]*$/

function presetWriter(): Plugin {
  const presets = '/__shaderlab/presets/'
  const exports = '/__shaderlab/export/'
  return {
    name: 'shaderlab-preset-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        // The app probes this once at startup to learn it has a writer.
        if (url === '/__shaderlab/ping' && (req.method === 'HEAD' || req.method === 'GET')) {
          res.statusCode = 204
          res.end()
          return
        }
        const fail = (status: number, message: string) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'text/plain')
          res.end(message)
        }
        const ok = (path: string) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path }))
        }
        // A malformed escape is a bad id, not a crashed request.
        const decode = (s: string) => {
          try {
            return decodeURIComponent(s)
          } catch {
            return ''
          }
        }
        // Delete: a card removed from the library, or the old file of a
        // renamed card once the new one is written.
        if (req.method === 'DELETE' && url.startsWith(presets)) {
          const id = decode(url.slice(presets.length))
          if (!SLUG.test(id)) return fail(400, 'preset id must be a slug')
          try {
            await unlink(resolve(root, 'presets', `${id}.json`))
            return ok(`presets/${id}.json (deleted)`)
          } catch (err) {
            return fail(404, err instanceof Error ? err.message : String(err))
          }
        }
        if (req.method !== 'POST' || !(url.startsWith(presets) || url.startsWith(exports))) return next()
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)
        try {
          if (url.startsWith(presets)) {
            // Save to file: presets/<id>.json from the preset as JSON.
            const id = decode(url.slice(presets.length))
            if (!SLUG.test(id)) return fail(400, 'preset id must be a slug')
            const json = JSON.parse(body.toString('utf8')) as Record<string, unknown>
            if (json.id !== id) return fail(400, 'preset id in the body does not match the URL')
            await writeFile(resolve(root, 'presets', `${id}.json`), `${JSON.stringify(sortKeys(json), null, 2)}\n`)
            return ok(`presets/${id}.json`)
          }
          // Export all: out/card-<id>.png from a PNG body, out/<id>.json from
          // JSON, and the handoff manifest regenerated from the library.
          const [id, kind] = decode(url.slice(exports.length)).split('/')
          if (id === 'backgrounds' && kind === undefined) {
            const json = JSON.parse(body.toString('utf8')) as Record<string, unknown>
            await mkdir(resolve(root, 'handoff'), { recursive: true })
            await writeFile(resolve(root, 'handoff', 'backgrounds.json'), `${JSON.stringify(json, null, 2)}\n`)
            return ok('handoff/backgrounds.json')
          }
          if (!SLUG.test(id ?? '')) return fail(400, 'preset id must be a slug')
          await mkdir(resolve(root, 'out'), { recursive: true })
          if (kind === 'png') {
            if (body.length < 8 || body.readUInt32BE(0) !== 0x89504e47) return fail(400, 'body is not a PNG')
            await writeFile(resolve(root, 'out', `card-${id}.png`), body)
            return ok(`out/card-${id}.png`)
          }
          if (kind === 'webm') {
            // EBML header: 1A 45 DF A3.
            if (body.length < 4 || body.readUInt32BE(0) !== 0x1a45dfa3) return fail(400, 'body is not a WebM')
            await writeFile(resolve(root, 'out', `card-${id}.webm`), body)
            return ok(`out/card-${id}.webm`)
          }
          if (kind === 'json') {
            const json = JSON.parse(body.toString('utf8')) as Record<string, unknown>
            if (json.id !== id) return fail(400, 'preset id in the body does not match the URL')
            await writeFile(resolve(root, 'out', `${id}.json`), `${JSON.stringify(sortKeys(json), null, 2)}\n`)
            return ok(`out/${id}.json`)
          }
          return fail(404, 'unknown export kind')
        } catch (err) {
          return fail(400, err instanceof Error ? err.message : String(err))
        }
      })
    },
  }
}

// Port 5176: 5173–5175 belong to HITL, Portfolio and the ui-kit docs site.
// .claude/launch.json passes the port; this is only the fallback for a bare
// `npm run dev`. `base` is `/` locally and `/ShaderLab/` on GitHub Pages
// (the workflow sets SHADERLAB_BASE); the app reads it as BASE_URL.
export default defineConfig({
  base: process.env.SHADERLAB_BASE ?? '/',
  plugins: [react(), presetWriter()],
  server: { port: 5176 },
})
