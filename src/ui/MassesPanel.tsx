import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialKitController, type DialConfig } from 'dialkit'
import { animate } from 'motion'
import { diffPaths, getDirty, getDraft, markDirty, revertToFile, setDraft, stableStringify, subscribeCards } from '../model/cards'
import { saveCard } from '../export/save'
import { getFamily, setFamily, useFamily } from '../model/family'
import { presetById } from '../model/presets'
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

function massConfig(mass: Mass, _family: Family) {
  return {
    color: oklchToHex(mass.hue, mass.value, mass.chroma),
    value: VALUE_OFFSET,
    position: {
      type: 'pad' as const,
      x: slider(mass.x, -0.5, 2, 0.01),
      y: slider(mass.y, -0.6, 1.6, 0.01),
      labels: { x: 'Across', y: 'Up' },
    },
    size: slider(mass.size, 0.1, 2, 0.01),
    softness: slider(mass.softness, 0.4, 0.9, 0.01),
    distance: slider(mass.distance, 0, 1, 0.01),
    locked: mass.locked,
  }
}

/** A mass slot beyond the draft's count: parked, so adding one is a no-op. */
const SPARE_MASS: Mass = { hue: 0, value: 0.5, chroma: 0, x: 1.2, y: 0.5, size: 0.6, softness: 0.7, distance: 0.8, locked: false }

function panelConfig(draft: CardDraft, family: Family, loopMax: number, reduced: boolean): DialConfig {
  const masses: Record<string, unknown> = { count: slider(draft.masses.length, 1, MAX_MASSES, 1) }
  MASS_KEYS.forEach((key, i) => {
    masses[key] = massConfig(draft.masses[i] ?? SPARE_MASS, family)
  })
  const d = draft.depth
  return {
    seed: slider(draft.seed, 0, 999999, 1),
    revertToFile: { type: 'action', label: 'Revert to file' },
    saveToFile: { type: 'action', label: 'Save to file' },
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
    texture: { grain: slider(draft.texture.grain, 0, 0.3, 0.005), animate: family.texture.animate },
    depth: {
      curve: { on: d.curve.on, amount: slider(d.curve.amount, 0, 1, 0.01) },
      parallax: { on: d.parallax.on, amount: slider(d.parallax.amount, 0, 1, 0.01) },
      haze: { on: d.haze.on, amount: slider(d.haze.amount, 0, 1, 0.01) },
      swirl: { on: d.swirl.on, amount: slider(d.swirl.amount, 0, 1, 0.01) },
      relief: {
        on: d.relief.on,
        amount: slider(d.relief.amount, 0, 1, 0.01),
        frequency: slider(d.relief.frequency, 10, 200, 1),
        twist: slider(d.relief.twist, -45, 45, 0.5),
      },
      shadow: {
        on: d.shadow.on,
        amount: slider(d.shadow.amount, 0, 1, 0.01),
        rectX: slider(d.shadow.rect[0], 0, 1, 0.01),
        rectY: slider(d.shadow.rect[1], 0, 1, 0.01),
        rectW: slider(d.shadow.rect[2], 0, 1, 0.01),
        rectH: slider(d.shadow.rect[3], 0, 1, 0.01),
        offset: slider(d.shadow.offset, 0, 0.2, 0.005),
        spread: slider(d.shadow.spread, 0, 0.5, 0.005),
      },
      captionMask: draft.captionMask,
    },
    // The Finish stage (SPEC.md §2): two blurs as post-process passes.
    finish: {
      motionBlur: {
        on: draft.finish.motionBlur.on,
        angle: slider(draft.finish.motionBlur.angle, -180, 180, 1),
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

/** The panel's values as a draft, over the current one. */
function draftFromValues(v: Values, current: CardDraft): CardDraft {
  const base = v.base as Values
  const modes = v.modes as Values
  const massesV = v.masses as Values
  const count = massesV.count as number
  const depth = v.depth as Values
  const motion = v.motion as Values
  const layer = (key: string) => depth[key] as Values
  const masses: Mass[] = []
  for (let i = 0; i < count; i++) {
    const m = massesV[MASS_KEYS[i]] as Values
    const pos = m.position as { x: number; y: number }
    masses.push({
      ...colourToOklch(m.color as string, m.value as number, current.masses[i]),
      x: pos.x,
      y: pos.y,
      size: m.size as number,
      softness: m.softness as number,
      distance: m.distance as number,
      locked: m.locked as boolean,
    })
  }
  const shadow = layer('shadow')
  const simple = (key: string) => ({ on: layer(key).on as boolean, amount: layer(key).amount as number })
  const finish = v.finish as Values
  const mb = finish.motionBlur as Values
  const lb = finish.layerBlur as Values
  return {
    seed: v.seed as number,
    modes: {
      colour: modes.colour as Modes['colour'],
      bold: modes.bold as boolean,
      coverage: modes.coverage as Modes['coverage'],
      structure: modes.structure as Modes['structure'],
    },
    base: { ...colourToOklch(base.color as string, base.value as number, current.base), locked: base.locked as boolean },
    masses,
    texture: { grain: (v.texture as Values).grain as number },
    depth: {
      curve: simple('curve'),
      parallax: simple('parallax'),
      haze: simple('haze'),
      swirl: simple('swirl'),
      relief: { ...simple('relief'), frequency: layer('relief').frequency as number, twist: layer('relief').twist as number },
      shadow: {
        ...simple('shadow'),
        rect: [shadow.rectX as number, shadow.rectY as number, shadow.rectW as number, shadow.rectH as number],
        offset: shadow.offset as number,
        spread: shadow.spread as number,
      },
    },
    finish: {
      motionBlur: {
        on: mb.on as boolean,
        angle: mb.angle as number,
        followAngle: mb.followFamilyAngle as boolean,
        length: mb.length as number,
        intensity: mb.intensity as number,
      },
      layerBlur: { on: lb.on as boolean, radius: lb.radius as number, intensity: lb.intensity as number },
    },
    captionMask: depth.captionMask as boolean,
    loop: { ...current.loop, seconds: motion.loopSeconds as number },
  }
}

/** The draft as panel values, for pushing a shuffle or a card switch into the panel. */
function valuesFromDraft(draft: CardDraft): Values {
  const masses: Values = { count: draft.masses.length }
  MASS_KEYS.forEach((key, i) => {
    const m = draft.masses[i]
    if (!m) return
    masses[key] = {
      color: oklchToHex(m.hue, m.value, m.chroma),
      value: 0,
      position: { x: m.x, y: m.y },
      size: m.size,
      softness: m.softness,
      distance: m.distance,
      locked: m.locked,
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
}

export function MassesPanel({ preset, handle, reduced }: MassesPanelProps) {
  const family = useFamily()
  // The scrub slider's range follows the loop length. A control's bounds
  // are part of the config, which DialKit reconciles when it changes.
  const [loopMax, setLoopMax] = useState(getDraft(preset.id).loop.seconds)

  // The config is built once per card, so a dial drag never rebuilds it.
  const config = useMemo(
    () => panelConfig(getDraft(preset.id), family, loopMax, reduced),
    // The draft is read once per card on purpose; later edits flow the
    // other way, from the panel into the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset.id, family, loopMax, reduced],
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
    if (pushingRef.current) return
    const current = getDraft(preset.id)
    const next = draftFromValues(v, current)
    // A mode changed on the panel: re-roll from the card's own seed with
    // that choice forced, but only the fields that mode governs, and never
    // a hand-edited or locked one.
    const changedModes = (Object.keys(next.modes) as (keyof Modes)[]).filter((k) => next.modes[k] !== current.modes[k])
    if (changedModes.length) {
      const origin = presetById(preset.id)
      if (origin) {
        const scope: RollScope = changedModes.includes('coverage')
          ? 'coverage'
          : changedModes.includes('structure')
            ? 'structure'
            : 'colour'
        setDraft(
          preset.id,
          rollScoped(origin, current, getFamily(), current.seed, scope, { forced: next.modes, dirty: getDirty(preset.id) }),
        )
        return
      }
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
      const draft = getDraft(preset.id)
      if (stableStringify(draftFromValues(dial.getValues() as Values, draft)) === stableStringify(draft)) return
      pushingRef.current = true
      dial.setValues(valuesFromDraft(draft) as never)
      queueMicrotask(() => {
        pushingRef.current = false
      })
    }
    push()
    return subscribeCards(push)
  }, [dial, preset.id])

  // --- Family dials: variety, grain animation, motion ---------------------------
  const variety = v.variety as number
  const grainAnimate = (v.texture as Values).animate as boolean
  const motionAmount = (v.motion as Values).motion as number
  useEffect(() => {
    const f = getFamily()
    if (f.variety === variety && f.texture.animate === grainAnimate && f.motion.amount === motionAmount) return
    setFamily((fam) => ({
      ...fam,
      variety,
      texture: { ...fam.texture, animate: grainAnimate },
      motion: { ...fam.motion, amount: motionAmount },
    }))
  }, [variety, grainAnimate, motionAmount])

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
