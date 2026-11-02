#!/usr/bin/env node
// Playwright smoke: `node scripts/smoke.mjs [url]`. Without a URL it starts its own dev server on
// 5181 (never 5176, which is Joe's). Any console error or uncaught exception fails the run, and so
// does the first step that does not do what the UI promises. Playwright and its Chromium come from a
// sibling repo (HITL, Films or Bitmania): nothing is downloaded. Nothing here saves, exports or deletes.
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5181
const STEP_MS = 10_000

const withPlaywright = (dir) => createRequire(resolve(root, dir, 'package.json'))('playwright').chromium
// Siblings of the repo, and of the repo a worktree under .claude/worktrees/ belongs to;
// PLAYWRIGHT_ROOT names any other install.
const candidates = [
  ...(process.env.PLAYWRIGHT_ROOT ? [process.env.PLAYWRIGHT_ROOT] : []),
  '.',
  ...['HITL', 'Films', 'Bitmania'].flatMap((name) => [`../${name}`, `../../../../${name}`]),
]
const chromium = candidates.reduce((found, dir) => {
  try { return found ?? withPlaywright(dir) } catch { return found }
}, null)
if (!chromium) throw new Error('no playwright install found in ShaderLab, its siblings (HITL, Films, Bitmania) or PLAYWRIGHT_ROOT')

let url = process.argv[2]
let server = null
if (!url) {
  const { createServer } = await import('vite')
  // Its own dep cache, so it never races the server on 5176 for .vite/deps.
  const config = { root, configFile: resolve(root, 'vite.config.ts'), cacheDir: 'node_modules/.vite-smoke', logLevel: 'silent' }
  server = await createServer({ ...config, server: { port: PORT, strictPort: true, host: 'localhost' } })
  await server.listen()
  url = `http://localhost:${PORT}/`
}

const errors = []
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`))
page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`))

let failed = null
const steps = []
async function step(name, fn) {
  if (failed) return
  const before = errors.length
  try {
    await fn()
    await page.waitForTimeout(120)
    if (errors.length > before) throw new Error(errors.slice(before).join('\n'))
    steps.push(`ok    ${name}`)
  } catch (err) {
    failed = { name, message: err instanceof Error ? err.message : String(err) }
    steps.push(`FAIL  ${name}`)
  }
}
const count = (sel) => page.locator(sel).count()
/** A point inside cell `i` that nothing covers (the DialKit popover sits over the right column). */
const pointIn = async (i, retry = true) =>
  page.evaluate((i) => {
    const el = document.querySelectorAll('.cell')[i]
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    for (const [x, y] of [[r.left + 16, r.bottom - 16], [r.left + 16, r.top + 16], [r.left + r.width / 2, r.top + r.height / 2]]) {
      if (el.contains(document.elementFromPoint(x, y))) return [x, y]
    }
    throw new Error(`cell ${i} (${el.getAttribute('aria-label')}) is covered by <${document.elementFromPoint(r.left + 16, r.bottom - 16)?.className}>`)
  }, i).catch(async (err) => {
    // Cells in a layout flight overlap each other for about half a second.
    if (!retry) throw err
    await page.waitForTimeout(800)
    return pointIn(i, false)
  })
const hoverCell = async (i) => page.mouse.move(...(await pointIn(i)))
const dial = (path, value) =>
  page.evaluate(([p, v]) => {
    const d = globalThis.__shaderlab?.dial
    if (!d) throw new Error('window.__shaderlab.dial is missing (is this a dev build?)')
    d.setValue(p, v)
    return d.getValues()
  }, [path, value])
const escapeFocus = async () => {
  await page.keyboard.press('Escape')
  await page.locator('.focus-chrome').waitFor({ state: 'detached', timeout: STEP_MS })
}
const focusCard = async (i) => {
  await page.mouse.click(...(await pointIn(i)))
  await page.locator('.focus-chrome').waitFor({ state: 'visible', timeout: STEP_MS })
}
const alerts = async () => {
  if ((await count('.cell-slot--broken')) > 0) throw new Error('a card boundary tripped (.cell-slot--broken)')
  if ((await count('.cell__lit[role="alert"]')) > 0) throw new Error(`a card shows an error: ${await page.locator('.cell__lit[role="alert"]').first().innerText()}`)
}

await step('load', async () => {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('.cell').first().waitFor({ timeout: STEP_MS })
  await page.locator('.dialkit-panel').first().waitFor({ timeout: STEP_MS })
  await alerts()
})
const n = await count('.cell')
const badgesAtStart = await count('.cell__badge')
await step(`hover every grid cell (${n}) with the panel open`, async () => {
  for (let i = 0; i < n; i++) await hoverCell(i)
  await page.mouse.move(5, 500)
})
await step('hovering alone marks no card as modified', async () => {
  await page.waitForTimeout(300)
  const now = await count('.cell__badge')
  if (now > badgesAtStart) throw new Error(`${now - badgesAtStart} card(s) gained a modified/unsaved badge from hovering`)
})
await step('click every grid card, open Focus, Escape', async () => {
  for (let i = 0; i < n; i++) await focusCard(i).then(escapeFocus)
})
await step('Grid → Rail, hover each rail cell, → Grid', async () => {
  await page.getByRole('button', { name: 'Rail', exact: true }).click()
  await page.locator('section.rail').waitFor({ timeout: STEP_MS })
  for (let i = 0; i < n; i++) await hoverCell(i)
  await page.mouse.move(5, 500)
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.locator('section.grid').waitFor({ timeout: STEP_MS })
})
await step('change each mode select once (through the real DialKit controller)', async () => {
  await hoverCell(0)
  const values = await dial('modes.bold', false)
  const next = { colour: ['mono', 'warm-cool', 'triad', 'free'], coverage: ['blend', 'block', 'flat'], structure: ['none', 'swirl', 'relief'] }
  for (const [key, options] of Object.entries(next)) {
    await dial(`modes.${key}`, options.find((o) => o !== values.modes?.[key]))
    await page.waitForTimeout(150)
  }
})
await step('Shuffle', () => page.getByRole('button', { name: 'Shuffle', exact: true }).click())
await step('Shuffle all', () => page.getByRole('button', { name: 'Shuffle all', exact: true }).click())
await step('open and close the Export sheet', async () => {
  await focusCard(0)
  await page.locator('.focus-chrome').getByRole('button', { name: 'Export', exact: true }).click()
  await page.locator('.sheet[role="dialog"]').waitFor({ state: 'visible', timeout: STEP_MS })
  await page.locator('.sheet').getByRole('button', { name: 'Done', exact: true }).click()
  await page.locator('.sheet').waitFor({ state: 'detached', timeout: STEP_MS })
  await escapeFocus()
})
await step('no card broke along the way', alerts)

await browser.close()
await server?.close()
for (const line of steps) console.log(`  ${line}`)
if (failed || errors.length) {
  console.log(`\nFAIL at "${failed?.name ?? 'end'}": ${failed?.message ?? 'console errors'}`)
  if (errors.length) console.log(`\nconsole:\n${errors.map((e) => `  ${e}`).join('\n')}`)
  process.exit(1)
}
console.log('\nPASS: smoke')
