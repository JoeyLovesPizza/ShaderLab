import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialKitController, type DialConfig } from 'dialkit'
import { animate } from 'motion'
import {
  diffPaths,
  getDirty,
  getDraft,
  getLink,
  hasCard,
  markDirty,
  revertToFile,
  setDraft,
  stableStringify,
  subscribeCards,
} from '../model/cards'
import { saveCard } from '../export/save'
import { importPhoto } from '../export/photo'
import { getFamily, setFamily, useFamily } from '../model/family'
import { getProject, relink, setPrimary, setProjectSpread, setProjectStyle, shuffleSource, spreadOfCard, subscribeProjects, useCardSpread } from '../model/projects'
import { styleOf } from '../model/project'
import { rollScoped, type RollScope } from '../model/shuffle'
import {
  COLOUR_MODES,
  COVERAGE_MODES,
  DEPTH_ORDER,
  LINK_PATHS,
  L_MAX,
  L_MIN,
  MAX_MASSES,
  STRUCTURE_MODES,
  type CardDraft,
  type Family,
  type LinkPath,
  type Mass,
  MASS_KINDS,
  blobMass,
  withMassShape,
  type Modes,
  type Preset,
  type StateName,
} from '../model/types'
import type { CardHandle } from '../shader/handle'
import { labToOklch, oklchToHex, parseColor, srgbToOklab } from '../palette/ramp'

/*
 * The card's DialKit panel (SPEC.md §2, the five stages): Base, Masses,
 * Texture, Depth, Motion, in that order, with the seed, the three rolled
 * modes, the project's Spread and the family's House pull at the top.
 *
 * Colour is picked as one colour (Joe: "I cannot pick colours" with
 * separate hue and chroma sliders) and stored as OKLCH h / L / C. The Value
 * slider is a lightness offset on top of the picked colour, −0.3..+0.3, so
 * brightness can be nudged without reopening the picker. Pushing a draft
 * into the panel shows the stored colour at offset 0.
 *
 * The panel is a view of the card store: its values become the card's
 * draft (and go to every cell), and a draft changed from elsewhere (the
 * shuffle, a card switch) is pushed back into it. One panel, one id, for
 * every card: switching cards is a config reconcile plus a push, never a
 * teardown of sixty controls in the middle of a flight.
 *
 * Overriding a mode re-rolls the card from its own seed with that choice
 * forced, so the numbers change to suit the mode but nothing else moves.
 * The transport and the state switcher need a live canvas, so they do
 * nothing without a handle (Browse); in Focus the session provides one.
 */

const SCRUB_STEP = 0.05
const STATES: StateName[] = ['idle', 'hover', 'active']
const EASE = { out: 'easeOut', inOut: 'easeInOut', in: 'easeIn', linear: 'linear' } as const
const MASS_KEYS = ['mass1', 'mass2', 'mass3', 'mass4'] as const

/*
 * Two scopes (SPEC.md §4): Background is the focused card; Project is the
 * style of the project it belongs to, edited through the same folders.
 * The panel is one DialKit config either way. Project scope drops the
 * folders that belong to a background alone (the config is rebuilt on a
 * scope change, which DialKit reconciles), and the draft the panel reads
 * and writes is the card's with the project's style laid over it.
 */
const SCOPES = ['Background', 'Project'] as const
type Scope = (typeof SCOPES)[number]

/** DialKit labels a folder from its key and cannot retitle it live, so the
    link state is a "Follows project" folder of toggles, one per linkable
    stage. A key cannot hold a dot, hence `depthLight`. */
const followKey = (path: LinkPath) => (path.startsWith('depth.') ? `depth${path[6].toUpperCase()}${path.slice(7)}` : path)

/** The draft the panel shows: the card's, with the project's style over it in Project scope. */
function viewDraft(id: string, scope: Scope): CardDraft {
  const draft = getDraft(id)
  const project = scope === 'Project' ? getProject(getLink(id).project) : undefined
  return project ? { ...draft, ...structuredClone(project.style) } : draft
}

type Slider = [number, number, number, number]
type Values = Record<string, unknown>

const slider = (v: number, min: number, max: number, step: number): Slider => [v, min, max, step]
const select = (options: readonly string[], value: string) => ({ type: 'select' as const, options: [...options], default: value })
const VALUE_OFFSET: Slider = [0, -0.3, 0.3, 0.005]

type Oklch = { hue: number; value: number; chroma: number }

/**
 * A picked colour string plus a lightness offset, as OKLCH h, L, C. When
 * the picker still shows the draft's own colour (same hex, no offset) the
 * draft's exact numbers are kept: a trip through 8-bit hex would otherwise
 * nudge them and mark an untouched card as modified.
 */
function colourToOklch(color: string, offset: number, current?: Oklch): Oklch {
  try {
    if (current && offset === 0 && color.toLowerCase() === oklchToHex(current.hue, current.value, current.chroma)) {
      return { hue: current.hue, value: current.value, chroma: current.chroma }
    }
    const [hue, L, chroma] = labToOklch(srgbToOklab(parseColor(color)))
    return { hue, value: Math.min(L_MAX, Math.max(L_MIN, L + offset)), chroma }
  } catch {
    return { hue: 0, value: 0.5, chroma: 0 }
  }
}

// Bounds are the validator's (validate.ts): a narrower control would
// clamp a valid file's value on the way in and mark it modified.
const pad = (p: { x: number; y: number }) => ({
  type: 'pad' as const,
  x: slider(p.x, -1, 3, 0.01),
  y: slider(p.y, -1, 2, 0.01),
  labels: { x: 'Across', y: 'Up' },
})

/**
 * One mass. A blob uses the colour, the position and the size; a ridge
 * (Kind) runs from Start through the position to End, `size` as its half
 * width, coloured Start → colour → End along it. One Value offset lifts
 * all three colours.
 */
function massConfig(raw: Mass, _family: Family) {
  const mass = withMassShape(raw)
  return {
    kind: select(MASS_KINDS, mass.kind),
    color: oklchToHex(mass.hue, mass.value, mass.chroma),
    value: VALUE_OFFSET,
    position: pad(mass),
    size: slider(mass.size, 0.05, 4, 0.01),
    softness: slider(mass.softness, 0, 1, 0.01),
    distance: slider(mass.distance, 0, 1, 0.01),
    locked: mass.locked,
    start: pad(mass.path.start),
    control1: pad(mass.path.control1),
    control2: pad(mass.path.control2),
    end: pad(mass.path.end),
    colorStart: oklchToHex(mass.ramp.start.hue, mass.ramp.start.value, mass.ramp.start.chroma),
    colorEnd: oklchToHex(mass.ramp.end.hue, mass.ramp.end.value, mass.ramp.end.chroma),
    fieldMix: slider(mass.ramp.fieldMix, 0, 1, 0.01),
  }
}

/** A mass slot beyond the draft's count: parked, so adding one is a no-op. */
const SPARE_MASS: Mass = blobMass({ hue: 0, value: 0.5, chroma: 0, x: 1.2, y: 0.5, size: 0.6, softness: 0.7, distance: 0.8, locked: false })

function panelConfig(draft: CardDraft, family: Family, spread: number, loopMax: number, reduced: boolean, isStatic: boolean, scope: Scope, owned: readonly LinkPath[]): DialConfig {
  const masses: Record<string, unknown> = { count: slider(draft.masses.length, 1, MAX_MASSES, 1) }
  MASS_KEYS.forEach((key, i) => {
    masses[key] = massConfig(draft.masses[i] ?? SPARE_MASS, family)
  })
  const d = draft.depth
  const config = {
    scope: select(SCOPES, scope),
    seed: slider(draft.seed, 0, 999999, 1),
    revertToFile: { type: 'action', label: 'Revert to file' },
    saveToFile: { type: 'action', label: isStatic ? 'Download preset' : 'Save to file' },
    // Spread is the focused card's project; House pull is the family's.
    spread: slider(spread, 0, 1, 0.01),
    housePull: slider(family.housePull, 0, 1, 0.01),
    newBackground: { type: 'action', label: 'New background' },
    shuffleProject: { type: 'action', label: 'Shuffle project' },
    makePrimary: { type: 'action', label: 'Make primary' },
    followsProject: Object.fromEntries(LINK_PATHS.map((path) => [followKey(path), !owned.includes(path)])),
    modes: {
      colour: select(COLOUR_MODES, draft.modes.colour),
      bold: draft.modes.bold,
      coverage: select(COVERAGE_MODES, draft.modes.coverage),
      structure: select(STRUCTURE_MODES, draft.modes.structure),
    },
    base: {
      color: oklchToHex(draft.base.hue, draft.base.value, draft.base.chroma),
      value: VALUE_OFFSET,
      locked: draft.base.locked,
    },
    masses,
    texture: { grain: slider(draft.texture.grain, 0, 0.5, 0.005), animate: family.texture.animate },
    depth: {
      // Light (SPEC.md §2): the card's height; the light itself is the
      // family's, in its own folder below.
      light: { on: d.light.on, height: slider(d.light.height, 0, 2, 0.01) },
      curve: { on: d.curve.on, amount: slider(d.curve.amount, 0, 1, 0.01) },
      parallax: { on: d.parallax.on, amount: slider(d.parallax.amount, 0, 1, 0.01) },
      haze: { on: d.haze.on, amount: slider(d.haze.amount, 0, 1, 0.01) },
      swirl: { on: d.swirl.on, amount: slider(d.swirl.amount, 0, 1, 0.01), scale: slider(d.swirl.scale, 0.1, 3, 0.05) },
      relief: {
        on: d.relief.on,
        amount: slider(d.relief.amount, 0, 1, 0.01),
        frequency: slider(d.relief.frequency, 1, 400, 1),
        twist: slider(d.relief.twist, -90, 90, 0.5),
      },
      strokes: {
        on: d.strokes.on,
        amount: slider(d.strokes.amount, 0, 0.2, 0.005),
        direction: slider(d.strokes.direction, -180, 180, 1),
        followFamilyAngle: d.strokes.followAngle,
        size: slider(d.strokes.size, 0.05, 2, 0.01),
        density: slider(d.strokes.density, 2, 60, 1),
        taper: slider(d.strokes.taper, 0, 0.5, 0.01),
        chaos: slider(d.strokes.chaos, 0, 1, 0.01),
        follow: slider(d.strokes.follow, 0, 1, 0.01),
        motion: slider(d.strokes.motion, 0, 1, 0.01),
      },
      shadow: {
        on: d.shadow.on,
        amount: slider(d.shadow.amount, 0, 1, 0.01),
        rectX: slider(d.shadow.rect[0], 0, 1, 0.01),
        rectY: slider(d.shadow.rect[1], 0, 1, 0.01),
        rectW: slider(d.shadow.rect[2], 0, 1, 0.01),
        rectH: slider(d.shadow.rect[3], 0, 1, 0.01),
        offset: slider(d.shadow.offset, 0, 0.5, 0.005),
        spread: slider(d.shadow.spread, 0, 1, 0.005),
      },
      captionMask: draft.captionMask,
    },
    // The Finish stage (SPEC.md §2): two blurs as post-process passes.
    finish: {
      motionBlur: {
        on: draft.finish.motionBlur.on,
        angle: slider(draft.finish.motionBlur.angle, -360, 360, 1),
        followFamilyAngle: draft.finish.motionBlur.followAngle,
        length: slider(draft.finish.motionBlur.length, 0, 0.3, 0.005),
        intensity: slider(draft.finish.motionBlur.intensity, 0, 1, 0.01),
      },
      layerBlur: {
        on: draft.finish.layerBlur.on,
        radius: slider(draft.finish.layerBlur.radius, 0, 0.15, 0.0025),
        intensity: slider(draft.finish.layerBlur.intensity, 0, 1, 0.01),
      },
    },
    // The Photo stage (SPEC.md §4): the file (an upload through DialKit's
    // image control lands as a drop) and the one fidelity dial.
    photo: {
      file: { type: 'image', default: draft.photo ? draft.photo.src : '' },
      fidelity: slider(draft.photo?.fidelity ?? 0.5, 0, 1, 0.01),
    },
    // The family's one light (SPEC.md §2, Light), shared by every card.
    light: {
      angle: slider(family.light.angle, -180, 180, 1),
      followFamilyAngle: family.light.followAngle,
      elevation: slider(family.light.elevation, 5, 90, 1),
      amount: slider(family.light.amount, 0, 0.5, 0.01),
    },
    motion: {
      // One knob for how much everything moves (family-wide).
      motion: slider(family.motion.amount, 0, 1, 0.01),
      loopSeconds: slider(draft.loop.seconds, 2, 60, 0.5),
      playing: !reduced,
      state: select(STATES, 'idle'),
      // Exclusive of the loop length itself, which wraps to 0.
      scrub: slider(0, 0, loopMax - SCRUB_STEP, SCRUB_STEP),
    },
  } as Record<string, unknown>
  if (scope === 'Project') {
    // What belongs to a background alone, and the family's own dials.
    for (const key of ['seed', 'revertToFile', 'saveToFile', 'makePrimary', 'followsProject', 'finish', 'photo', 'light', 'motion']) delete config[key]
    delete (config.texture as Values).animate
    delete (config.depth as Values).captionMask
  }
  return config as DialConfig
}

const isValues = (v: unknown): v is Values => typeof v === 'object' && v !== null
const folder = (v: Values, key: string): Values => (isValues(v[key]) ? v[key] : {})
const num = (v: Values, key: string, fallback: number) => (typeof v[key] === 'number' ? v[key] : fallback)
const bool = (v: Values, key: string, fallback: boolean) => (typeof v[key] === 'boolean' ? v[key] : fallback)

/**
 * The panel's values as a draft, over the current one. Any value the
 * panel does not have (a folder DialKit has not registered yet, a key
 * from an older config) falls back to the current draft's, so this can
 * never throw and unmount the panel with it.
 */
function draftFromValues(v: Values, current: CardDraft): CardDraft {
  const base = folder(v, 'base')
  const modes = folder(v, 'modes')
  const massesV = folder(v, 'masses')
  const count = Math.min(MAX_MASSES, Math.max(0, num(massesV, 'count', current.masses.length)))
  const depth = folder(v, 'depth')
  const motion = folder(v, 'motion')
  const layer = (key: string) => folder(depth, key)
  const masses: Mass[] = []
  for (let i = 0; i < count; i++) {
    const m = folder(massesV, MASS_KEYS[i])
    const was = withMassShape(current.masses[i] ?? current.masses[current.masses.length - 1] ?? SPARE_MASS)
    const pos = isValues(m.position) ? m.position : {}
    const point = (key: string, was: { x: number; y: number }) => {
      const p = isValues(m[key]) ? (m[key] as Values) : {}
      return { x: num(p, 'x', was.x), y: num(p, 'y', was.y) }
    }
    const offset = num(m, 'value', 0)
    const colour = (key: string, was: { hue: number; value: number; chroma: number }) =>
      colourToOklch(typeof m[key] === 'string' ? (m[key] as string) : oklchToHex(was.hue, was.value, was.chroma), offset, was)
    masses.push({
      kind: MASS_KINDS.includes(m.kind as never) ? (m.kind as Mass['kind']) : was.kind,
      ...colour('color', was),
      x: num(pos, 'x', was.x),
      y: num(pos, 'y', was.y),
      size: num(m, 'size', was.size),
      softness: num(m, 'softness', was.softness),
      distance: num(m, 'distance', was.distance),
      locked: bool(m, 'locked', was.locked),
      path: {
        start: point('start', was.path.start),
        control1: point('control1', was.path.control1),
        control2: point('control2', was.path.control2),
        end: point('end', was.path.end),
      },
      ramp: { start: colour('colorStart', was.ramp.start), end: colour('colorEnd', was.ramp.end), fieldMix: num(m, 'fieldMix', was.ramp.fieldMix) },
    })
  }
  const shadow = layer('shadow')
  const simple = (key: Exclude<keyof CardDraft['depth'], 'light'>) => ({
    on: bool(layer(key), 'on', current.depth[key].on),
    amount: num(layer(key), 'amount', current.depth[key].amount),
  })
  const finish = folder(v, 'finish')
  const mb = folder(finish, 'motionBlur')
  const lb = folder(finish, 'layerBlur')
  const mode = <K extends keyof Modes>(key: K, allowed: readonly string[]): Modes[K] =>
    (allowed.includes(modes[key] as string) ? modes[key] : current.modes[key]) as Modes[K]
  const wasRect = current.depth.shadow.rect
  return {
    seed: num(v, 'seed', current.seed),
    modes: {
      colour: mode('colour', COLOUR_MODES),
      bold: bool(modes, 'bold', current.modes.bold),
      coverage: mode('coverage', COVERAGE_MODES),
      structure: mode('structure', STRUCTURE_MODES),
    },
    base: {
      ...colourToOklch(
        typeof base.color === 'string' ? base.color : oklchToHex(current.base.hue, current.base.value, current.base.chroma),
        num(base, 'value', 0),
        current.base,
      ),
      locked: bool(base, 'locked', current.base.locked),
    },
    masses: masses.length ? masses : current.masses,
    texture: { grain: num(folder(v, 'texture'), 'grain', current.texture.grain) },
    depth: {
      light: {
        on: bool(layer('light'), 'on', current.depth.light.on),
        height: num(layer('light'), 'height', current.depth.light.height),
      },
      curve: simple('curve'),
      parallax: simple('parallax'),
      haze: simple('haze'),
      swirl: { ...simple('swirl'), scale: num(layer('swirl'), 'scale', current.depth.swirl.scale) },
      relief: {
        ...simple('relief'),
        frequency: num(layer('relief'), 'frequency', current.depth.relief.frequency),
        twist: num(layer('relief'), 'twist', current.depth.relief.twist),
      },
      strokes: {
        ...simple('strokes'),
        direction: num(layer('strokes'), 'direction', current.depth.strokes.direction),
        followAngle: bool(layer('strokes'), 'followFamilyAngle', current.depth.strokes.followAngle),
        size: num(layer('strokes'), 'size', current.depth.strokes.size),
        density: num(layer('strokes'), 'density', current.depth.strokes.density),
        taper: num(layer('strokes'), 'taper', current.depth.strokes.taper),
        chaos: num(layer('strokes'), 'chaos', current.depth.strokes.chaos),
        follow: num(layer('strokes'), 'follow', current.depth.strokes.follow),
        motion: num(layer('strokes'), 'motion', current.depth.strokes.motion),
      },
      shadow: {
        ...simple('shadow'),
        rect: [
          num(shadow, 'rectX', wasRect[0]),
          num(shadow, 'rectY', wasRect[1]),
          num(shadow, 'rectW', wasRect[2]),
          num(shadow, 'rectH', wasRect[3]),
        ],
        offset: num(shadow, 'offset', current.depth.shadow.offset),
        spread: num(shadow, 'spread', current.depth.shadow.spread),
      },
    },
    finish: {
      motionBlur: {
        on: bool(mb, 'on', current.finish.motionBlur.on),
        angle: num(mb, 'angle', current.finish.motionBlur.angle),
        followAngle: bool(mb, 'followFamilyAngle', current.finish.motionBlur.followAngle),
        length: num(mb, 'length', current.finish.motionBlur.length),
        intensity: num(mb, 'intensity', current.finish.motionBlur.intensity),
      },
      layerBlur: {
        on: bool(lb, 'on', current.finish.layerBlur.on),
        radius: num(lb, 'radius', current.finish.layerBlur.radius),
        intensity: num(lb, 'intensity', current.finish.layerBlur.intensity),
      },
    },
    captionMask: bool(depth, 'captionMask', current.captionMask),
    loop: { ...current.loop, seconds: num(motion, 'loopSeconds', current.loop.seconds) },
    // The file itself is set by a drop or an upload (handled outside the
    // draft); the panel only moves the fidelity.
    photo: current.photo ? { src: current.photo.src, fidelity: num(folder(v, 'photo'), 'fidelity', current.photo.fidelity) } : null,
  }
}

/** The draft as panel values, for pushing a shuffle or a card switch into the panel. */
function valuesFromDraft(draft: CardDraft): Values {
  const masses: Values = { count: draft.masses.length }
  MASS_KEYS.forEach((key, i) => {
    const raw = draft.masses[i]
    if (!raw) return
    const m = withMassShape(raw)
    masses[key] = {
      kind: m.kind,
      color: oklchToHex(m.hue, m.value, m.chroma),
      value: 0,
      position: { x: m.x, y: m.y },
      size: m.size,
      softness: m.softness,
      distance: m.distance,
      locked: m.locked,
      start: { x: m.path.start.x, y: m.path.start.y },
      control1: { x: m.path.control1.x, y: m.path.control1.y },
      control2: { x: m.path.control2.x, y: m.path.control2.y },
      end: { x: m.path.end.x, y: m.path.end.y },
      colorStart: oklchToHex(m.ramp.start.hue, m.ramp.start.value, m.ramp.start.chroma),
      colorEnd: oklchToHex(m.ramp.end.hue, m.ramp.end.value, m.ramp.end.chroma),
      fieldMix: m.ramp.fieldMix,
    }
  })
  const d = draft.depth
  const depth: Values = { captionMask: draft.captionMask }
  for (const name of DEPTH_ORDER) {
    if (name === 'shadow') {
      depth.shadow = {
        on: d.shadow.on,
        amount: d.shadow.amount,
        rectX: d.shadow.rect[0],
        rectY: d.shadow.rect[1],
        rectW: d.shadow.rect[2],
        rectH: d.shadow.rect[3],
        offset: d.shadow.offset,
        spread: d.shadow.spread,
      }
    } else if (name === 'strokes') {
      const { followAngle, ...rest } = d.strokes
      depth.strokes = { ...rest, followFamilyAngle: followAngle }
    } else {
      depth[name] = { ...d[name] }
    }
  }
  return {
    seed: draft.seed,
    modes: { ...draft.modes },
    base: { color: oklchToHex(draft.base.hue, draft.base.value, draft.base.chroma), value: 0, locked: draft.base.locked },
    masses,
    texture: { grain: draft.texture.grain },
    depth,
    finish: {
      motionBlur: {
        on: draft.finish.motionBlur.on,
        angle: draft.finish.motionBlur.angle,
        followFamilyAngle: draft.finish.motionBlur.followAngle,
        length: draft.finish.motionBlur.length,
        intensity: draft.finish.motionBlur.intensity,
      },
      layerBlur: { ...draft.finish.layerBlur },
    },
    motion: { loopSeconds: draft.loop.seconds },
    photo: { file: draft.photo?.src ?? '', fidelity: draft.photo?.fidelity ?? 0.5 },
  }
}

interface MassesPanelProps {
  preset: Preset
  /** The live card, in Focus. Without it the transport is inert. */
  handle: CardHandle | null
  reduced: boolean
  /** Hosted build: the save action downloads instead. */
  isStatic: boolean
  /** New background in this card's project (App adds it and selects it). */
  onNewBackground: () => void
  /** Re-roll this card's project style. */
  onShuffleProject: () => void
}

export function MassesPanel({ preset, handle, reduced, isStatic, onNewBackground, onShuffleProject }: MassesPanelProps) {
  const family = useFamily()
  // The scrub slider's range follows the loop length. A control's bounds
  // are part of the config, which DialKit reconciles when it changes.
  const [loopMax, setLoopMax] = useState(getDraft(preset.id).loop.seconds)
  const [scope, setScope] = useState<Scope>('Background')

  // The config is built once per card, so a dial drag never rebuilds it.
  const config = useMemo(
    () => panelConfig(viewDraft(preset.id, scope), family, spreadOfCard(preset.id), loopMax, reduced, isStatic, scope, getLink(preset.id).overrides),
    // The draft is read once per card on purpose; later edits flow the
    // other way, from the panel into the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset.id, family, loopMax, reduced, isStatic, scope],
  )
  const dial = useDialKitController('Card', config, {
    id: 'shaderlab-card',
    onAction: (path) => {
      if (path.endsWith('revertToFile')) revertToFile(preset.id)
      if (path.endsWith('newBackground')) onNewBackground()
      if (path.endsWith('shuffleProject')) onShuffleProject()
      if (path.endsWith('makePrimary')) setPrimary(getLink(preset.id).project, preset.id)
      if (path.endsWith('saveToFile')) {
        saveCard(preset).catch((err: unknown) => console.warn('[ShaderLab] save failed:', err))
      }
    },
  })
  const v = dial.values as Values
  // The scope select drives the config; the config follows it one render later.
  const pickedScope = SCOPES.find((s) => s === v.scope)
  useEffect(() => {
    if (pickedScope && pickedScope !== scope) setScope(pickedScope)
  }, [pickedScope, scope])
  // The panel's values as they stood right after a push from the store.
  // Values equal to these came from the store and must not be written back;
  // a flag would stay set when the push changed nothing the draft reads.
  const pushedRef = useRef<string | null>(null)
  // Dev only: the controller, so a check can drive the real edit path.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __shaderlab?: Record<string, unknown> }
    w.__shaderlab = { ...(w.__shaderlab ?? {}), dial }
  }
  // On a card switch (and the first mount) the panel's values are not yet
  // the card's: writing them to the draft was how hovering a thumbnail
  // repainted it as the card before. The push below syncs first.
  const shownPresetRef = useRef<string | null>(null)
  // A scope change is a switch too: the panel holds the other scope's numbers until the push.
  const shownKey = `${preset.id}|${scope}`

  // --- Panel -> card store -------------------------------------------------
  const draftKey = stableStringify(draftFromValues(v, viewDraft(preset.id, scope)))
  useEffect(() => {
    if (shownPresetRef.current !== shownKey) {
      shownPresetRef.current = shownKey
      return
    }
    // The run that follows a push: those values came from the store, and
    // what DialKit made of them (a pad's rounding) must not go back as an
    // edit.
    const pushed = pushedRef.current
    pushedRef.current = null
    if (pushed !== null && stableStringify(v) === pushed) return
    const current = viewDraft(preset.id, scope)
    const next = draftFromValues(v, current)
    const projectId = getLink(preset.id).project
    // A mode changed on the panel: re-roll from the card's own seed with
    // that choice forced, but only the fields that mode governs, and never
    // a hand-edited or locked one.
    const changedModes = (Object.keys(next.modes) as (keyof Modes)[]).filter((k) => next.modes[k] !== current.modes[k])
    if (changedModes.length) {
      // The project's style is the origin (the card's own values when it
      // has none), at the project's spread.
      const source = shuffleSource(preset.id)
      const rollScope: RollScope = changedModes.includes('coverage')
        ? 'coverage'
        : changedModes.includes('structure')
          ? 'structure'
          : 'colour'
      if (scope === 'Project') {
        // The style rolls from itself; no card's hand edits apply to it.
        const rolled = rollScoped(current, current, getFamily(), getDraft(preset.id).seed, rollScope, {
          forced: next.modes,
          dirty: new Set(),
          spread: source.spread,
        })
        setProjectStyle(projectId, styleOf(rolled))
        return
      }
      setDraft(
        preset.id,
        rollScoped(source.origin ?? preset, current, getFamily(), current.seed, rollScope, {
          forced: next.modes,
          dirty: getDirty(preset.id),
          spread: source.spread,
        }),
      )
      return
    }
    if (scope === 'Project') {
      // Linked backgrounds follow at once (setProjectStyle); hand-edit marks are a background's.
      if (stableStringify(styleOf(next)) !== stableStringify(styleOf(current))) setProjectStyle(projectId, styleOf(next))
      return
    }
    if (stableStringify(next) !== stableStringify(current)) {
      // Whatever Joe just moved by hand is his until he says otherwise.
      markDirty(preset.id, diffPaths(current, next).filter((p) => !p.startsWith('loop') && !p.startsWith('modes') && p !== 'seed'))
      setDraft(preset.id, next)
    }
    setLoopMax(next.loop.seconds)
    // draftKey stands in for every dial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, preset.id, shownKey])

  // --- Card store -> panel (a card switch, or the shuffle) --------------------
  useEffect(() => {
    const push = () => {
      // Renamed or deleted under the panel: the next render brings the
      // card that replaces it.
      if (!hasCard(preset.id)) return
      const draft = viewDraft(preset.id, scope)
      if (stableStringify(draftFromValues(dial.getValues() as Values, draft)) === stableStringify(draft)) return
      dial.setValues(valuesFromDraft(draft) as never)
      pushedRef.current = stableStringify(dial.getValues())
    }
    push()
    const offCards = subscribeCards(push)
    const offProjects = subscribeProjects(push)
    return () => {
      offCards()
      offProjects()
    }
  }, [dial, preset.id, scope])

  // --- Links: which stages follow the project --------------------------------------
  // A toggle per stage, on while it follows. Switching one on relinks it;
  // switching a linked one off has no meaning (an edit does that), so it springs back.
  const pushLinks = useRef(() => {})
  pushLinks.current = () => {
    if (scope !== 'Background' || !hasCard(preset.id)) return
    const owned = getLink(preset.id).overrides
    const want = Object.fromEntries(LINK_PATHS.map((path) => [followKey(path), !owned.includes(path)]))
    if (stableStringify(folder(dial.getValues() as Values, 'followsProject')) !== stableStringify(want)) {
      dial.setValues({ followsProject: want } as never)
    }
  }
  useEffect(() => {
    pushLinks.current()
    return subscribeCards(() => pushLinks.current())
  }, [dial, preset.id, scope])
  const followsKey = stableStringify(folder(v, 'followsProject'))
  useEffect(() => {
    if (scope !== 'Background') return
    const follows = folder(v, 'followsProject')
    for (const path of getLink(preset.id).overrides) if (follows[followKey(path)] === true) relink(preset.id, path)
    pushLinks.current()
    // followsKey stands in for the toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followsKey])

  // --- Photo upload through the image control --------------------------------
  // DialKit hands an uploaded picture over as a URL (data: or blob:); a
  // value that is neither empty nor the card's own src is a new photo.
  const photoFile = typeof folder(v, 'photo').file === 'string' ? (folder(v, 'photo').file as string) : ''
  const importingRef = useRef(false)
  useEffect(() => {
    const current = getDraft(preset.id).photo?.src ?? ''
    if (!photoFile || photoFile === current || importingRef.current) return
    if (!photoFile.startsWith('data:') && !photoFile.startsWith('blob:')) return
    importingRef.current = true
    fetch(photoFile)
      .then((r) => r.blob())
      .then((blob) => importPhoto(preset.id, blob))
      .catch((err: unknown) => console.warn('[ShaderLab] photo upload failed:', err))
      .finally(() => {
        importingRef.current = false
      })
  }, [photoFile, preset.id])

  // --- Spread: the card's project, two ways ------------------------------------
  // Whichever side moved since the last run wins; on a card switch the
  // project's value is pushed in, never the old card's value out.
  const storeSpread = useCardSpread(preset.id)
  const panelSpread = v.spread as number
  const spreadSeenRef = useRef<{ id: string; store: number; panel: number } | null>(null)
  useEffect(() => {
    const seen = spreadSeenRef.current
    spreadSeenRef.current = { id: preset.id, store: storeSpread, panel: panelSpread }
    if (!seen || seen.id !== preset.id || seen.store !== storeSpread) {
      if (panelSpread !== storeSpread) dial.setValues({ spread: storeSpread } as never)
      return
    }
    if (seen.panel !== panelSpread && panelSpread !== storeSpread) setProjectSpread(getLink(preset.id).project, panelSpread)
  }, [dial, preset.id, storeSpread, panelSpread])

  // --- Family dials: house pull, grain animation, motion ---------------------------
  const housePull = v.housePull as number
  // Project scope has no family folders for these; the family's own value stands.
  const grainAnimate = bool(folder(v, 'texture'), 'animate', family.texture.animate)
  const motionAmount = num(folder(v, 'motion'), 'motion', family.motion.amount)
  const lightV = folder(v, 'light')
  const lightKey = stableStringify(lightV)
  useEffect(() => {
    const f = getFamily()
    const light = {
      angle: num(lightV, 'angle', f.light.angle),
      followAngle: bool(lightV, 'followFamilyAngle', f.light.followAngle),
      elevation: num(lightV, 'elevation', f.light.elevation),
      amount: num(lightV, 'amount', f.light.amount),
    }
    if (
      f.housePull === housePull &&
      f.texture.animate === grainAnimate &&
      f.motion.amount === motionAmount &&
      stableStringify(f.light) === stableStringify(light)
    ) {
      return
    }
    setFamily((fam) => ({
      ...fam,
      housePull,
      texture: { ...fam.texture, animate: grainAnimate },
      motion: { ...fam.motion, amount: motionAmount },
      light,
    }))
    // lightKey stands in for the light folder's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [housePull, grainAnimate, motionAmount, lightKey])

  // --- Transport and states, only with a live card ------------------------------
  const motion = folder(v, 'motion')
  const playing = bool(motion, 'playing', !reduced)
  const scrub = num(motion, 'scrub', 0)
  const stateName = (STATES.find((s) => s === motion.state) ?? 'idle') as StateName
  const prevStateRef = useRef<StateName>('idle')
  const lastHandleRef = useRef<CardHandle | null>(null)

  useEffect(() => {
    if (!handle) return
    if (playing && !reduced) handle.play()
    else handle.pause()
  }, [handle, playing, reduced])

  useEffect(() => {
    if (handle && (!playing || reduced)) handle.seek(scrub)
  }, [handle, playing, scrub, reduced])

  // The state grammar (SPEC.md §4): hover lifts every mass's value, active
  // lifts it more and flattens chroma. In with the state's duration, out
  // with the leaving state's durationOut; reduced motion snaps.
  useEffect(() => {
    if (!handle) return
    const target = {
      u_exposure: preset.states?.[stateName]?.uniforms.u_exposure ?? 0,
      u_contrast: preset.states?.[stateName]?.uniforms.u_contrast ?? 1,
    }
    const prev = prevStateRef.current
    // A newly focused card starts in whatever state the switcher shows:
    // snap it there, then animate only on later changes.
    if (handle !== lastHandleRef.current) {
      lastHandleRef.current = handle
      prevStateRef.current = stateName
      handle.setUniforms(target)
      return
    }
    if (prev === stateName) return
    prevStateRef.current = stateName
    if (reduced) {
      handle.setUniforms(target)
      return
    }
    const leaving = preset.states?.[prev]?.transition
    const entering = preset.states?.[stateName]?.transition
    const toIdle = stateName === 'idle'
    const duration = toIdle ? (leaving?.durationOut ?? leaving?.duration ?? 0.3) : (entering?.duration ?? 0.3)
    const ease = EASE[(toIdle ? leaving?.ease : entering?.ease) ?? 'out']
    const current = handle.getState().uniforms
    const from = { u_exposure: current.u_exposure as number, u_contrast: current.u_contrast as number }
    const controls = animate(0, 1, {
      duration,
      ease,
      onUpdate: (p) => {
        handle.setUniforms({
          u_exposure: from.u_exposure + (target.u_exposure - from.u_exposure) * p,
          u_contrast: from.u_contrast + (target.u_contrast - from.u_contrast) * p,
        })
      },
    })
    return () => controls.stop()
  }, [handle, preset, stateName, reduced])

  return null
}
