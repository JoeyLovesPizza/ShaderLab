# ShaderLab

## What this is
A generator for animated shader backgrounds for the Portfolio carousel cards (`../Portfolio`): one WebGL2 shader (`masses@1`: a base, up to four soft colour masses or ridges, a lit height field, depth, brush-mark strokes and blur stages, static grain), a seeded shuffle, a library of presets, a Browse (grid or rail) / Focus workflow with an Export sheet, and an export path (preset JSON, PNG → WebP, WebM → MP4) into `Portfolio/public/`. React 19, Vite 8, TypeScript 6, Motion, DialKit. `SPEC.md` is the source of truth for direction, decisions and schema. `BACKLOG.md` is what is in flight, next and known broken. Read both before changing anything, and update `BACKLOG.md` when a job lands or stops.

## Run
- `npm run dev` on port 5176 (`.claude/launch.json` → `shaderlab-dev`, `autoPort` on; 5173–5175 belong to HITL, Portfolio and ui-kit's site). Use the launch config, not a hand-started server.
- `npm run build` (`tsc -b && vite build`), `npm run lint` (oxlint), `npm run preview`. `npm run check` is the gate before anything merges to main: app type-check, oxlint, every preset through the validator, the vitest suite under `tests/`, and the Playwright smoke in `scripts/smoke.mjs` (finds Chromium through the sibling HITL repo or `PLAYWRIGHT_ROOT`).
- Hosted at https://joeylovespizza.github.io/ShaderLab/ from the `gh-pages` branch. `npm run deploy` builds with `SHADERLAB_BASE=/ShaderLab/` and force-pushes `dist` to `gh-pages` from a throwaway worktree; run it from a green main. The Actions workflow in `deploy/pages.yml` is parked until the CLI token has the `workflow` scope (`gh auth refresh -h github.com -s workflow`), after which it moves back to `.github/workflows/` and Pages switches to the workflow source. The hosted build has no middleware: Save and Export fall back to downloads.
- Joe works on a branch and merges to main as prod. Builder agents work in a worktree (`.claude/worktrees/lab`, port 5179), never in the main checkout that Joe's 5176 serves.

## Layout
- `src/shader/` `masses.ts` (the one shader, `masses@1`), `massesManifest.ts` (uniform table), `renderer.ts` (pure WebGL2), `stage.ts` (the shared offscreen renderer and clock every card draws through), `useStageHandle.ts`, `range.ts`. `src/model/` the schema-2 types, the never-throwing validator, `presets.ts` (loads `presets/*.json`; a bad file becomes a flat card with its error), `family.ts` and `cards.ts` (stores), `pack.ts` (draft → uniforms), `shuffle.ts` (seeded; modes first, then numbers). `src/palette/` OKLab/OKLCH maths and gamut mapping. `src/states/` the workflow state machine. `src/ui/` `Cell` (grid cell, rail card and focused card are one element), `Browse`, `FocusSession`, `ExportSheet`, `MassesPanel` (the one DialKit panel, id `shaderlab-card`, never persisted: the card store is the truth), `CardBoundary`. `src/export/` PNG, preset JSON, WebM stub. Each folder's README says what belongs there.
- `src/design-system/` tokens copied from Portfolio (no fonts; system-ui for now). `presets/` tracked preset JSON plus `family.json` (`presets/examples/` is not loaded). `reference/` inspiration images (gitignored). `out/` exports (gitignored).
- `handoff/`: what another agent needs to place a background on a Portfolio carousel card. `README.md` (read it first), `ShaderBackground.tsx` and `shader-background.css` to copy into Portfolio, and `backgrounds.json`, the manifest with each card's file and `shadowColor`. A background is an asset on the card's art layer, under the UI artwork; it is never a card.
- Files are the truth: a card's edits and shuffles are a localStorage overlay (badge "modified") until "Save to file" writes `presets/<id>.json` through the dev server's middleware in `vite.config.ts`; "Revert to file" drops the overlay. "Export all" writes `out/card-<id>.png` (2×) and `out/<id>.json` the same way; `npm run ship` converts the PNGs to WebP (`cwebp`, q88, about 180 KB each) into `../Portfolio/public/work/shaders/` and copies the presets and `handoff/backgrounds.json` into `../Portfolio/public/shaders/`. It never touches `Portfolio/src`. Joe runs ship, never the tool.
- In dev, `window.__shaderlab` exposes the stores and the stage for console checks; a dynamic `import()` after an HMR update gets a different module instance.

## Rules
- `dialkit` is pinned to exactly `2.0.2` (the version Portfolio runs). Do not add a caret; do not add three.js or react-three-fiber (SPEC.md §4).
- No semicolons, single quotes, 2-space indent, named exports (`App` is the only default), comments explain why. Same as Portfolio.
- Never commit fonts, asset masters or anything under `out/` or `reference/`. `.claude/settings.local.json` and `.claude/worktrees/` are ignored.
- Every rendering change reports fps at six thumbnails plus one focused card on this Mac.
- Every preset schema change (a field added, renamed, reshaped, in `types.ts`) ships with three things: a migration in `validate.ts` (`withDefaults` / `withMassDefaults`, so an older file or overlay loads with a warning, never as invalid), a bump of `meta.version` in `presets/family.json` and `DEFAULT_FAMILY` (the card store clears stale localStorage overlays once on the next load), and a case in `tests/model/overlay.test.ts` for the shape being left behind. Overlays and library cards go through `migrateOverlay` on every load; nothing renders a draft that has not passed the validator.

## Roles
The session talking to Joe is the Planner: it holds SPEC.md and BACKLOG.md, sequences the work, and is the only one that talks to Joe. A Builder executes one job. A Critic gives a verdict in words on a finished render against SPEC.md §2 and the images in `reference/`. It never sets numbers or mechanisms; treat any it offers as a suggestion for a Builder to measure, not a spec decision.

## Working cheaply (Joe, 2026-11-04)
The first two weeks burned through usage credits. The cause was process, not the work: one Builder agent ran for thirty jobs and re-read its whole history on every resume, which cost 500k–900k tokens a round by the end, including one-line fixes. These rules exist so that does not happen again.

- **One fresh agent per job.** Never resume a Builder or Critic across jobs. Brief a new one with the job, the files, and what done looks like, and point it at SPEC.md, BACKLOG.md and this file instead of retyping them.
- **Do small things inline.** A handful of edits, a one-line fix, a config change: do it in the session, with no agent.
- **Pick the model for the job.** Sonnet for mechanical work (plumbing, migrations, tests, wiring, export). A bigger model only for shader maths and look-tuning judgement.
- **Critic rarely.** Only for a new look Joe wants a second eye on, never for a before/after he can judge himself, never after every step. Start it fresh, hand it the screenshot and reference paths, and cap the answer at about 300 words.
- **Verify cheaply.** Prefer page text, DOM queries and pixel checks to screenshots. One screenshot per decision Joe has to see, not one per step.
- **Run `npm run check` once, at the end of a job.** The smoke is the expensive part. Use `tsc` and the vitest suite while iterating.
- **Run agents in parallel only when the work is independent.**
- **Keep sessions short.** Start a new session from `~/Projects/ShaderLab` per job or per day. State lives in SPEC.md, BACKLOG.md, this file and memory, never only in a conversation.
- **On a usage-limit stop, commit WIP to the branch first** (`WIP:` subject), push it, and note it in BACKLOG.md, so the next session picks it up from git.
