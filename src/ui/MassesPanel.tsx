import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialKitController, type DialConfig } from 'dialkit'
import { animate } from 'motion'
import {
  diffPaths,
  getDirty,
  getDraft,
  hasCard,
  markDirty,
  revertToFile,
  setDraft,
  stableStringify,
  subscribeCards,
} from '../model/cards'
import { saveCard } from '../export/save'
import { getFamily, setFamily, useFamily } from '../model/family'
import { rollScoped, type RollScope } from '../model/shuffle'
import {
  COLOUR_MODES,
  COVERAGE_MODES,
  DEPTH_ORDER,
  L_MAX,
  L_MIN,
  MAX_MASSES,
  STRUCTURE_MODES,
  type CardDraft,
  type Family,
  type Mass,
  MASS_KINDS,
  blobMass,
  type Modes,
  type Preset,
  type StateName,
} from '../model/types'
import type { CardHandle } from '../shader/handle'
import { labToOklch, oklchToHex, parseColor, srgbToOklab } from '../palette/ramp'

/*
 * The card's DialKit panel (SPEC.md §2, the five stages): Base, Masses,
 * Texture, Depth, Motion, in that order, with the seed, the three rolled
 * modes and the family's variety dial at the top.
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
function massConfig(mass: Mass, _family: Family) {
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
    end: pad(mass.path.end),
    colorStart: oklchToHex(mass.ramp.start.hue, mass.ramp.start.value, mass.ramp.start.chroma),
    colorEnd: oklchToHex(mass.ramp.end.hue, mass.ramp.end.value, mass.ramp.end.chroma),
  }
}

/** A mass slot beyond the draft's count: parked, so adding one is a no-op. */
const SPARE_MASS: Mass = blobMass({ hue: 0, value: 0.5, chroma: 0, x: 1.2, y: 0.5, size: 0.6, softness: 0.7, distance: 0.8, locked: false })

function panelConfig(draft: CardDraft, family: Family, loopMax: number, reduced: boolean, isStatic: boolean): DialConfig {
  const masses: Record<string, unknown> = { count: slider(draft.masses.length, 1, MAX_MASSES, 1) }
  MASS_KEYS.forEach((key, i) => {
    masses[key] = massConfig(draft.masses[i] ?? SPARE_MASS, family)
  })
  const d = draft.depth
  return {
    seed: slider(draft.seed, 0, 999999, 1),
    revertToFile: { type: 'action', label: 'Revert to file' },
    saveToFile: { type: 'action', label: isStatic ? 'Download preset' : 'Save to file' },
    variety: slider(family.variety, 0, 1, 0.01),
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
        length: slider(d.strokes.length, 0.05, 2, 0.01),
        density: slider(d.strokes.density, 5, 400, 1),
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
  } as DialConfig
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
    const was = current.masses[i] ?? current.masses[current.masses.length - 1] ?? SPARE_MASS
    const pos = isValues(m.position) ? m.position : {}
    const start = isValues(m.start) ? m.start : {}
    const end = isValues(m.end) ? m.end : {}
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
        start: { x: num(start, 'x', was.path.start.x), y: num(start, 'y', was.path.start.y) },
        end: { x: num(end, 'x', was.path.end.x), y: num(end, 'y', was.path.end.y) },
      },
      ramp: { start: colour('colorStart', was.ramp.start), end: colour('colorEnd', was.ramp.end) },
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
        length: num(layer('strokes'), 'length', current.depth.strokes.length),
        density: num(layer('strokes'), 'density', current.depth.strokes.density),
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
  }
}

/** The draft as panel values, for pushing a shuffle or a card switch into the panel. */
function valuesFromDraft(draft: CardDraft): Values {
  const masses: Values = { count: draft.masses.length }
  MASS_KEYS.forEach((key, i) => {
    const m = draft.masses[i]
    if (!m) return
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
      end: { x: m.path.end.x, y: m.path.end.y },
      colorStart: oklchToHex(m.ramp.start.hue, m.ramp.start.value, m.ramp.start.chroma),
      colorEnd: oklchToHex(m.ramp.end.hue, m.ramp.end.value, m.ramp.end.chroma),
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
  }
}

interface MassesPanelProps {
  preset: Preset
  /** The live card, in Focus. Without it the transport is inert. */
  handle: CardHandle | null
  reduced: boolean
  /** Hosted build: the save action downloads instead. */
  isStatic: boolean
}

export function MassesPanel({ preset, handle, reduced, isStatic }: MassesPanelProps) {
  const family = useFamily()
  // The scrub slider's range follows the loop length. A control's bounds
  // are part of the config, which DialKit reconciles when it changes.
  const [loopMax, setLoopMax] = useState(getDraft(preset.id).loop.seconds)

  // The config is built once per card, so a dial drag never rebuilds it.
  const config = useMemo(
    () => panelConfig(getDraft(preset.id), family, loopMax, reduced, isStatic),
    // The draft is read once per card on purpose; later edits flow the
    // other way, from the panel into the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset.id, family, loopMax, reduced, isStatic],
  )
  const dial = useDialKitController('Card', config, {
    id: 'shaderlab-card',
    onAction: (path) => {
      if (path.endsWith('revertToFile')) revertToFile(preset.id)
      if (path.endsWith('saveToFile')) {
        saveCard(preset).catch((err: unknown) => console.warn('[ShaderLab] save failed:', err))
      }
    },
  })
  const v = dial.values as Values
  // Values written by a push from the store must not be written back.
  const pushingRef = useRef(false)
  // Dev only: the controller, so a check can drive the real edit path.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __shaderlab?: Record<string, unknown> }
    w.__shaderlab = { ...(w.__shaderlab ?? {}), dial }
  }
  // On a card switch (and the first mount) the panel's values are not yet
  // the card's: writing them to the draft was how hovering a thumbnail
  // repainted it as the card before. The push below syncs first.
  const shownPresetRef = useRef<string | null>(null)

  // --- Panel -> card store -------------------------------------------------
  const draftKey = stableStringify(draftFromValues(v, getDraft(preset.id)))
  useEffect(() => {
    if (shownPresetRef.current !== preset.id) {
      shownPresetRef.current = preset.id
      return
    }
    // The run that follows a push: those values came from the store, and
    // what DialKit made of them (a pad's rounding) must not go back as an
    // edit. Cleared here, not in a microtask, which would run before this
    // effect does.
    if (pushingRef.current) {
      pushingRef.current = false
      return
    }
    const current = getDraft(preset.id)
    const next = draftFromValues(v, current)
    // A mode changed on the panel: re-roll from the card's own seed with
    // that choice forced, but only the fields that mode governs, and never
    // a hand-edited or locked one.
    const changedModes = (Object.keys(next.modes) as (keyof Modes)[]).filter((k) => next.modes[k] !== current.modes[k])
    if (changedModes.length) {
      // The library card is the origin: its file's values, or what a new
      // card was born with.
      const scope: RollScope = changedModes.includes('coverage')
        ? 'coverage'
        : changedModes.includes('structure')
          ? 'structure'
          : 'colour'
      setDraft(
        preset.id,
        rollScoped(preset, current, getFamily(), current.seed, scope, { forced: next.modes, dirty: getDirty(preset.id) }),
      )
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
  }, [draftKey, preset.id])

  // --- Card store -> panel (a card switch, or the shuffle) --------------------
  useEffect(() => {
    const push = () => {
      // Renamed or deleted under the panel: the next render brings the
      // card that replaces it.
      if (!hasCard(preset.id)) return
      const draft = getDraft(preset.id)
      if (stableStringify(draftFromValues(dial.getValues() as Values, draft)) === stableStringify(draft)) return
      const before = stableStringify(dial.getValues())
      pushingRef.current = true
      dial.setValues(valuesFromDraft(draft) as never)
      // No change in the panel means no effect run to clear the flag.
      if (stableStringify(dial.getValues()) === before) pushingRef.current = false
    }
    push()
    return subscribeCards(push)
  }, [dial, preset.id])

  // --- Family dials: variety, grain animation, motion ---------------------------
  const variety = v.variety as number
  const grainAnimate = (v.texture as Values).animate as boolean
  const motionAmount = (v.motion as Values).motion as number
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
      f.variety === variety &&
      f.texture.animate === grainAnimate &&
      f.motion.amount === motionAmount &&
      stableStringify(f.light) === stableStringify(light)
    ) {
      return
    }
    setFamily((fam) => ({
      ...fam,
      variety,
      texture: { ...fam.texture, animate: grainAnimate },
      motion: { ...fam.motion, amount: motionAmount },
      light,
    }))
    // lightKey stands in for the light folder's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variety, grainAnimate, motionAmount, lightKey])

  // --- Transport and states, only with a live card ------------------------------
  const motion = v.motion as Values
  const playing = motion.playing as boolean
  const scrub = motion.scrub as number
  const stateName = motion.state as StateName
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
