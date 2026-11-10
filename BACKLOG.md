# Backlog

What is in flight, next, and known broken. SPEC.md holds direction and decisions; this file holds status. Update it when a job lands, stops, or changes shape. Last updated 2026-11-10.

## In flight

### Photo stage (branch `claude/backlog-work-102406`: `lab` plus main plus the extraction fix, pushed, not merged)
Joe's ask: drop in a photo and process it with the toolkit, so the card lands somewhere between the photo and the abstract field (SPEC.md §4, "Photo stage" and "The continuum").

Done:
- Drop a photo on a card or the grid, or pick one in the panel's Photo folder. It's cover-fit to 1226×816 and saved as WebP to `presets/photos/<id>.webp` in dev, or to IndexedDB on the hosted site.
- A four-level blur pyramid in OKLab, with each level auto-levelled and its chroma restored. Extraction runs k-means on the W/22 level.
- Fidelity tables in `src/model/photo.ts`, plus PNG and WebM export, ship, the manifest, and schema family version 7 with an overlay test.
- **The pale daisies are fixed (2026-11-04).** There were two causes in `src/model/extract.ts`. Masses were picked by area, so the one white split into three near-identical whites. They are now picked greedily by OKLab distance to what is already chosen, so the second white loses to the yellow centres. The bigger cause was that the white is petals scattered over the whole frame, and one blob at their centroid sized by their total area (0.57) blanketed the card. Size is now scaled by the cluster's compactness squared, so the white is 0.23. Near-white coverage went from 60% to 7% at 0.2 and from 11% to 0.4% at 0.5; 0.8 is unchanged. `presets/daisies.json` is re-extracted. `tests/model/extract.test.ts` runs on a 64×43 fixture of the daisies.
- `npm run check` is green with 84 tests.

Open:
- **Test with Joe's own photos.** None are in `reference/` yet; ask for two or three with a clear light source and large forms. A photo with one large, compact form is the case the compactness rule hasn't been tried on.
- Then Joe judges the before/after sheet (no Critic pass), merge into main, run `npm install` on main, `npm run check`, push, `npm run deploy`, and remove the `lab` and `backlog-work-102406` worktrees and branches.

## Next: projects and backgrounds (SPEC.md §4, "Projects and backgrounds")
Joe, 2026-11-06: the cards all feel alike, and he wants to set how alike, per project, with many backgrounds per project. Five jobs, in order, one fresh Builder each:
1. ~~**Schema**~~ landed 2026-11-06: `presets/projects/<id>.json` for the nine cards, `project` and `overrides` on each background, `src/model/project.ts` (resolve, relink, style edits flow to linked backgrounds), `housePull` and `spread` fields, family version 8. All nine cards are pixel-identical to before. No UI yet: in dev, `__shaderlab.getProject`, `setProjectStyle` and `relink`. Overrides are kept in the card store (localStorage `shaderlab:links`); a shuffle that changes a linked stage marks it overridden.
2. ~~**Spread and House pull**~~ landed 2026-11-09: a background shuffles from its project's style at the project's Spread; House pull widens the family ranges and opens unused layers (swirl, strokes, shadow) below 1; New background and Shuffle project in the panel, which replace Variety. Two fixes found in review: the dark-mass guardrail no longer drains a project's hero colour (Paper's blue went grey at Spread 0.15), and a roll that loses most of its project's lightness range is re-rolled (Spread 0.85 made blank cards). Known: a "flat" coverage roll can still come out soft and even; judge it in job 3 with real browsing.
3. ~~**Browse grouped by project**~~ landed 2026-11-09: a header per project (name, count, Spread, New background, Shuffle project), primary first with a tag, an "N own" badge, a Background/Project scope in the panel, Make primary. DialKit 2.0.2 can't retitle a folder live, so links are a "Follows Project" folder of on/off toggles, one per stage; switching one on relinks it.
3b. ~~**Siblings that follow their project**~~ landed 2026-11-10: each background has a `variation` seed (null for the nine originals); its linked stages are derived from the project's style at that seed and the project's Spread. New background and Shuffle set a seed and mark nothing own; a style, Spread or House pull change re-derives every sibling live; unsaved siblings survive a reload unchanged. Family version 9. Tuning to judge: Spread is not smooth, since each sibling's colour mode, coverage and structure flip at their own dice value, so a drag makes some siblings jump rather than drift.
4. ~~**Motion per project and per mass**~~ landed 2026-11-10: a card `motion` stage (travel, tempo; a LinkPath), per-mass `motion` (path, travel, angle, pulse, shift), rolled by the shuffle at the spread, a Motion folder per mass and Travel/Tempo/Loop seconds on the card. The family's Motion dial is gone; `family.motion` is the house default and ranges. Family version 10. The nine cards render pixel-identically (checked against renders from before job 1, max diff 0) and loops meet exactly. House ranges: travel 0.35–0.85, tempo 1–3, mass travel 0.6–1.5, pulse 0–0.15, shift 0–18°. **Open: fps not measured after the change.** The app was not on screen, so frame timing was meaningless; before, six thumbnails plus one focused card ran at 60 fps (GPU 0.5–1.6 ms). Measure again with the window visible before merging.
5. **Handoff and ship** (next) for several backgrounds per project; `primary` ships, the rest are alternates.

Then: new shape kinds (bands, lines, edges, flow fields).

## Next, after that
- **Video clips per state.** Each preset's `states` block (idle, hover, active) is previewed in Focus. Export should write one loop per state, idle and active only (SPEC.md §4, runtime path A).
- **Live `ShaderCard` package (path B).** A component that Portfolio or any site can import, with measured performance numbers, behind a flag and with video as the fallback (SPEC.md §9).

## Later
- **Compose mode.** Images, text and code snippets layered over a finished background, each animated on a timeline. This is Joe's long-term goal and the second of his two assets.
- An editor timeline, and GIF export.

## Waiting on Joe
- **Silk-fold reference image.** It never reached disk. Drop it into `reference/texture-silk-fold.webp`.
- **The `workflow` scope on the gh CLI token** (`gh auth refresh -h github.com -s workflow`). With it, `deploy/pages.yml` moves back to `.github/workflows/` and deploys run automatically on merge to main. Until then, run `npm run deploy` by hand.
- **Wiring backgrounds into Portfolio cards.** Joe's own agent does this from `handoff/`. A background shows only once the card's UI art is exported with a transparent surround; the current Figma exports are opaque.

## Known issues
- `.claude/launch.json` has a second entry, `shaderlab-worktree` on 5179, because `autoPort` did not move `shaderlab-dev` off 5176 from a worktree.
- The smoke script borrows Playwright and Chromium from the sibling `HITL` repo, or from `PLAYWRIGHT_ROOT`. Port 5181 is sometimes held by CaseFilms, so the smoke falls back to another port.
- The WebM loop seam carries about 2/255 of codec drift between the last and first frames. That's quality drift, not motion. QuickTime cannot play VP9, which is why ship also writes MP4.
- The Strokes painted-grass preset is close to its reference but not identical. The Critic last called it "fibres, smeared", which was acceptable.
- Four lint warnings predate the photo work (ref-in-render, setState-in-effect), in the same pattern Portfolio uses.

## Landed
| Date | What |
|---|---|
| 2026-10-28 | Repo, spec, the masses model, colour pickers, shuffle with colour, coverage and structure modes, grid, rail, focus, PNG export, six project presets |
| 2026-10-29 | WebP ship, agent handoff, visible motion with one Motion dial, Grid layer cut, hand-edited values protected from shuffles |
| 2026-11-02 | QA stability pass, `npm run check`, preset library, hosted site on GitHub Pages, Light (lit height field), Strokes, ridge masses, the panel on the hosted build, animated strokes |
| 2026-11-04 | Photo masses picked by contrast and sized by compactness (daisies no longer wash out) |
| 2026-11-06 | Projects and backgrounds, job 1: schema, inheritance, migration |
| 2026-11-09 | Projects and backgrounds, job 2: Spread, House pull, New background, Shuffle project |
| 2026-11-09 | Projects and backgrounds, job 3: grouped Browse, panel scopes, Follows Project, Make primary |
| 2026-11-10 | Projects and backgrounds, job 3b: variation seeds, so siblings follow their project and Spread is live |
| 2026-11-10 | Projects and backgrounds, job 4: motion per project and per mass (path, travel, pulse, colour shift, tempo, loop length) |
| 2026-11-03 | Cubic ridge with field mix (silk fold), WebM export with MP4 on ship, browser overlays migrated like files, Strokes as brush marks with chaos and follow |
