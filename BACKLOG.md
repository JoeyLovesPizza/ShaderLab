# Backlog

What is in flight, next, and known broken. SPEC.md holds direction and decisions; this file holds status. Update it when a job lands, stops, or changes shape. Last updated 2026-11-04.

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

## Next
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
| 2026-11-03 | Cubic ridge with field mix (silk fold), WebM export with MP4 on ship, browser overlays migrated like files, Strokes as brush marks with chaos and follow |
