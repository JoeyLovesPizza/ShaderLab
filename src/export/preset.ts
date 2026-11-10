import { withMassShape, type CardDraft, type LinkPath, type Preset, type Project } from '../model/types'

/**
 * The preset as the card now is: the draft (seed, modes, base, masses,
 * texture, depth, motion, caption switch, loop) over the file it started from.
 * Numbers are rounded so a nudge of a dial is one clean line in a diff.
 * `link` is the card's project and overrides as the store holds them now
 * (cards.ts getLink); without it the preset's own stand.
 */
export function presetFromCard(
  preset: Preset,
  draft: CardDraft,
  loop: { stillTime: number; loopSeconds: number },
  link?: { project: string; overrides: LinkPath[]; variation: number | null },
): Preset {
  const r = (n: number, places = 4) => Number(n.toFixed(places))
  const d = draft.depth
  return {
    ...preset,
    project: link?.project ?? preset.project,
    overrides: [...(link?.overrides ?? preset.overrides)],
    variation: link ? link.variation : preset.variation,
    seed: draft.seed,
    modes: { ...draft.modes },
    base: { ...draft.base, hue: r(draft.base.hue, 1), value: r(draft.base.value), chroma: r(draft.base.chroma) },
    masses: draft.masses.map(withMassShape).map((m) => ({
      ...m,
      hue: r(m.hue, 1),
      value: r(m.value),
      chroma: r(m.chroma),
      x: r(m.x),
      y: r(m.y),
      size: r(m.size),
      softness: r(m.softness),
      distance: r(m.distance),
      path: {
        start: { x: r(m.path.start.x), y: r(m.path.start.y) },
        control1: { x: r(m.path.control1.x), y: r(m.path.control1.y) },
        control2: { x: r(m.path.control2.x), y: r(m.path.control2.y) },
        end: { x: r(m.path.end.x), y: r(m.path.end.y) },
      },
      ramp: {
        start: { hue: r(m.ramp.start.hue, 1), value: r(m.ramp.start.value), chroma: r(m.ramp.start.chroma) },
        end: { hue: r(m.ramp.end.hue, 1), value: r(m.ramp.end.value), chroma: r(m.ramp.end.chroma) },
        fieldMix: r(m.ramp.fieldMix),
      },
      motion: { path: m.motion.path, travel: r(m.motion.travel), angle: r(m.motion.angle, 1), pulse: r(m.motion.pulse), shift: r(m.motion.shift, 1) },
    })),
    texture: { grain: r(draft.texture.grain) },
    motion: { travel: r(draft.motion.travel), tempo: draft.motion.tempo },
    depth: {
      light: { ...d.light, height: r(d.light.height) },
      curve: { ...d.curve, amount: r(d.curve.amount) },
      parallax: { ...d.parallax, amount: r(d.parallax.amount) },
      haze: { ...d.haze, amount: r(d.haze.amount) },
      swirl: { ...d.swirl, amount: r(d.swirl.amount) },
      relief: { ...d.relief, amount: r(d.relief.amount) },
      strokes: {
        ...d.strokes,
        amount: r(d.strokes.amount),
        direction: r(d.strokes.direction, 1),
        size: r(d.strokes.size),
        density: r(d.strokes.density, 1),
        taper: r(d.strokes.taper),
        chaos: r(d.strokes.chaos),
        follow: r(d.strokes.follow),
        motion: r(d.strokes.motion),
      },
      shadow: { ...d.shadow, amount: r(d.shadow.amount), rect: d.shadow.rect.map((n) => r(n)) as [number, number, number, number] },
    },
    captionMask: draft.captionMask,
    photo: draft.photo ? { src: draft.photo.src, fidelity: r(draft.photo.fidelity) } : null,
    loop: { ...preset.loop, seconds: loop.loopSeconds, stillTime: loop.stillTime },
  }
}

/** Pretty-printed with keys sorted at every level, so diffs are one line per value. */
export function serializePreset(preset: Preset): string {
  return `${JSON.stringify(sortKeys(preset), null, 2)}\n`
}

/** A project file, in the same format as a preset. */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(sortKeys(project), null, 2)}\n`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key])
    return out
  }
  return value
}
