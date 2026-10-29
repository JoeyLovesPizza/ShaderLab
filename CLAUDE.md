# ShaderLab

## What this is
A generator for animated shader backgrounds for the Portfolio carousel cards (`../Portfolio`): one WebGL2 shader (`masses@1`: a base, up to four soft colour masses, depth and blur stages, static grain), a seeded shuffle, a Browse (grid or rail) / Focus workflow with an Export sheet, and an export path (preset JSON, PNG → WebP, WebM stubbed) into `Portfolio/public/`. React 19, Vite 8, TypeScript 6, Motion, DialKit. `SPEC.md` is the source of truth: direction, open questions, decisions, schema, states, phases. Read it before changing anything.

## Run
- `npm run dev` on port 5176 (`.claude/launch.json` → `shaderlab-dev`, `autoPort` on; 5173–5175 belong to HITL, Portfolio and ui-kit's site). Use the launch config, not a hand-started server.
- `npm run build` (`tsc -b && vite build`), `npm run lint` (oxlint), `npm run preview`. No tests yet.

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

## Roles
Planner holds SPEC.md, sequences the work and is the only agent that talks to Joe. Critic reviews each step against SPEC.md §2 and every preset on the Portfolio page. Builder executes one phase step at a time against the reuse map in SPEC.md §5.
