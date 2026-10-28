import {
  COLOUR_MODES,
  COVERAGE_MODES,
  DEPTH_ORDER,
  L_MAX,
  L_MIN,
  MAX_MASSES,
  STRUCTURE_LAYERS,
  STRUCTURE_MODES,
  type Family,
  type Mass,
  type Preset,
  type Range,
} from './types'

/*
 * Checks unknown JSON against the schema in SPEC.md §4 and the tonal rules
 * in §2. Never throws: a result reports, and the loader decides what to
 * show. Shape and range failures are issues; soft rules are warnings.
 */

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: []; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; warnings: ValidationIssue[] }

const SHADER_ID = /^[a-z][a-z0-9-]*@\d+$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

class Issues {
  list: ValidationIssue[] = []
  add(path: string, message: string) {
    this.list.push({ path, message })
  }
  num(obj: Obj, key: string, path: string, min = -Infinity, max = Infinity) {
    const v = obj[key]
    if (!isNum(v)) this.add(`${path}.${key}`, 'must be a finite number')
    else if (v < min || v > max) this.add(`${path}.${key}`, `must be between ${min} and ${max}`)
  }
  bool(obj: Obj, key: string, path: string) {
    if (typeof obj[key] !== 'boolean') this.add(`${path}.${key}`, 'must be true or false')
  }
  range(obj: Obj, key: string, path: string, min: number, max: number) {
    const v = obj[key]
    if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum) || v[0] > v[1] || v[0] < min || v[1] > max) {
      this.add(`${path}.${key}`, `must be a [min, max] pair within ${min}..${max}`)
    }
  }
}

function checkLayer(issues: Issues, value: unknown, path: string) {
  if (!isObj(value)) {
    issues.add(path, 'must be { on, amount }')
    return null
  }
  issues.bool(value, 'on', path)
  issues.num(value, 'amount', path, 0, 1)
  return value
}

/** Fields added after the first files were written take their defaults
    when missing, so an older file still loads as it did. */
const FINISH_DEFAULT = {
  motionBlur: { on: false, angle: 20, followAngle: true, length: 0.1, intensity: 0.6 },
  layerBlur: { on: false, radius: 0.04, intensity: 0.6 },
}

function withDefaults(input: Obj, warnings: Issues): Obj {
  const out: Obj = { ...input }
  if (out.finish === undefined) out.finish = structuredClone(FINISH_DEFAULT)
  // The Grid layer was cut (2026-10-28); an older file's key is dropped.
  if (isObj(out.depth) && 'grid' in out.depth) {
    const { grid: _grid, ...rest } = out.depth
    out.depth = rest
    warnings.add('depth.grid', 'the Grid layer no longer exists; the key was ignored')
  }
  else if (isObj(out.finish)) {
    const f = out.finish
    out.finish = {
      motionBlur: { ...FINISH_DEFAULT.motionBlur, ...(isObj(f.motionBlur) ? f.motionBlur : {}) },
      layerBlur: { ...FINISH_DEFAULT.layerBlur, ...(isObj(f.layerBlur) ? f.layerBlur : {}) },
    }
  }
  return out
}

function checkFinish(issues: Issues, value: unknown) {
  if (!isObj(value) || !isObj(value.motionBlur) || !isObj(value.layerBlur)) {
    issues.add('finish', 'must be { motionBlur, layerBlur }')
    return
  }
  const m = value.motionBlur
  issues.bool(m, 'on', 'finish.motionBlur')
  issues.num(m, 'angle', 'finish.motionBlur', -360, 360)
  issues.bool(m, 'followAngle', 'finish.motionBlur')
  issues.num(m, 'length', 'finish.motionBlur', 0, 0.3)
  issues.num(m, 'intensity', 'finish.motionBlur', 0, 1)
  const l = value.layerBlur
  issues.bool(l, 'on', 'finish.layerBlur')
  issues.num(l, 'radius', 'finish.layerBlur', 0, 0.15)
  issues.num(l, 'intensity', 'finish.layerBlur', 0, 1)
}

function checkMass(issues: Issues, value: unknown, path: string): value is Mass {
  if (!isObj(value)) {
    issues.add(path, 'must be a mass')
    return false
  }
  issues.num(value, 'hue', path, 0, 360)
  issues.num(value, 'value', path, L_MIN, L_MAX)
  issues.num(value, 'chroma', path, 0, 0.4)
  issues.num(value, 'x', path, -1, 3)
  issues.num(value, 'y', path, -1, 2)
  issues.num(value, 'size', path, 0.05, 4)
  issues.num(value, 'softness', path, 0, 1)
  issues.num(value, 'distance', path, 0, 1)
  issues.bool(value, 'locked', path)
  return true
}

/** Checks an unknown JSON value against the preset rules in SPEC.md §4. */
export function validatePreset(raw: unknown): ValidationResult<Preset> {
  const issues = new Issues()
  const warnings = new Issues()
  if (!isObj(raw)) {
    return { ok: false, issues: [{ path: '', message: 'preset must be an object' }], warnings: [] }
  }
  const input = withDefaults(raw, warnings)

  if (input.schema !== 2) issues.add('schema', 'must be 2')
  if (typeof input.id !== 'string' || !input.id) issues.add('id', 'must be a non-empty string')
  if (typeof input.shader !== 'string' || !SHADER_ID.test(input.shader)) {
    issues.add('shader', 'must be a versioned id like masses@1')
  }

  if (!isObj(input.canvas)) issues.add('canvas', 'must be { width, height, dpr }')
  else {
    issues.num(input.canvas, 'width', 'canvas', 1)
    issues.num(input.canvas, 'height', 'canvas', 1)
    issues.num(input.canvas, 'dpr', 'canvas', 0.5, 4)
  }

  if (!isObj(input.loop)) issues.add('loop', 'must be { seconds, fps, stillTime }')
  else {
    issues.num(input.loop, 'seconds', 'loop', 0.5)
    issues.num(input.loop, 'fps', 'loop', 1, 120)
    issues.num(input.loop, 'stillTime', 'loop', 0)
    if (isNum(input.loop.seconds) && isNum(input.loop.stillTime) && input.loop.stillTime > input.loop.seconds) {
      issues.add('loop.stillTime', 'must be within the loop')
    }
  }

  issues.num(input, 'seed', '', 0)

  if (!isObj(input.modes)) issues.add('modes', 'must be { colour, bold, coverage, structure }')
  else {
    const m = input.modes
    if (!COLOUR_MODES.includes(m.colour as never)) issues.add('modes.colour', `must be one of ${COLOUR_MODES.join(', ')}`)
    issues.bool(m, 'bold', 'modes')
    if (!COVERAGE_MODES.includes(m.coverage as never)) issues.add('modes.coverage', `must be one of ${COVERAGE_MODES.join(', ')}`)
    if (!STRUCTURE_MODES.includes(m.structure as never)) issues.add('modes.structure', `must be one of ${STRUCTURE_MODES.join(', ')}`)
  }

  if (!isObj(input.base)) issues.add('base', 'must be { hue, value, chroma, locked }')
  else {
    issues.num(input.base, 'hue', 'base', 0, 360)
    issues.num(input.base, 'value', 'base', L_MIN, L_MAX)
    issues.num(input.base, 'chroma', 'base', 0, 0.4)
    issues.bool(input.base, 'locked', 'base')
  }

  checkFinish(issues, input.finish)

  if (!Array.isArray(input.masses) || input.masses.length < 1 || input.masses.length > MAX_MASSES) {
    issues.add('masses', `must be one to ${MAX_MASSES} masses`)
  } else {
    input.masses.forEach((mass, i) => checkMass(issues, mass, `masses.${i}`))
  }

  if (!isObj(input.texture)) issues.add('texture', 'must be { grain }')
  else issues.num(input.texture, 'grain', 'texture', 0, 0.5)

  if (!isObj(input.depth)) issues.add('depth', `must be { ${DEPTH_ORDER.join(', ')} }`)
  else {
    for (const layer of DEPTH_ORDER) {
      const v = checkLayer(issues, input.depth[layer], `depth.${layer}`)
      if (!v) continue
      if (layer === 'relief') {
        issues.num(v, 'frequency', 'depth.relief', 1, 400)
        issues.num(v, 'twist', 'depth.relief', -90, 90)
      }
      if (layer === 'shadow') {
        const rect = v.rect
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(isNum)) {
          issues.add('depth.shadow.rect', 'must be [x, y, w, h] as fractions of the card')
        }
        issues.num(v, 'offset', 'depth.shadow', 0, 0.5)
        issues.num(v, 'spread', 'depth.shadow', 0, 1)
      }
    }
    // Of Swirl and Relief at most one may be on (SPEC.md §4).
    const depth = input.depth
    const structuresOn = STRUCTURE_LAYERS.filter((name) => {
      const layer = depth[name]
      return isObj(layer) && layer.on === true
    })
    if (structuresOn.length > 1) {
      issues.add('depth', `only one of swirl and relief may be on; ${structuresOn.join(' and ')} are`)
    }
  }

  issues.bool(input, 'captionMask', '')

  if (input.image !== null && input.image !== undefined) {
    if (!isObj(input.image)) issues.add('image', 'must be null or { src, fidelity, rampSource }')
    else {
      const src = input.image.src
      if (typeof src !== 'string' || !src) issues.add('image.src', 'must be a path')
      else if (src.startsWith('data:')) issues.add('image.src', 'must be a path under public/, never a data URL')
      issues.num(input.image, 'fidelity', 'image', 0, 1)
      if (input.image.rampSource !== 'extracted' && input.image.rampSource !== 'edited') {
        issues.add('image.rampSource', "must be 'extracted' or 'edited'")
      }
    }
  }

  if (input.states !== undefined) {
    if (!isObj(input.states)) issues.add('states', 'must be an object of named states')
    else {
      if (!isObj(input.states.idle)) issues.add('states.idle', 'is the base state and must exist')
      for (const [name, state] of Object.entries(input.states)) {
        if (!['idle', 'hover', 'active'].includes(name)) issues.add(`states.${name}`, "must be 'idle', 'hover' or 'active'")
        if (!isObj(state) || !isObj(state.uniforms)) {
          issues.add(`states.${name}`, 'must be { uniforms, loop?, transition? }')
          continue
        }
        for (const [key, v] of Object.entries(state.uniforms)) {
          if (key !== 'u_exposure' && key !== 'u_contrast') {
            issues.add(`states.${name}.uniforms.${key}`, 'a state may move u_exposure (mass value) and u_contrast (mass chroma) only')
          } else if (!isNum(v)) issues.add(`states.${name}.uniforms.${key}`, 'must be a number')
        }
        if (state.transition !== undefined) {
          if (!isObj(state.transition)) issues.add(`states.${name}.transition`, 'must be { duration, ease, durationOut? }')
          else {
            issues.num(state.transition, 'duration', `states.${name}.transition`, 0)
            if (state.transition.durationOut !== undefined) {
              issues.num(state.transition, 'durationOut', `states.${name}.transition`, 0)
            }
            if (!['out', 'inOut', 'in', 'linear'].includes(String(state.transition.ease))) {
              issues.add(`states.${name}.transition.ease`, "must be 'out', 'inOut', 'in' or 'linear'")
            }
          }
        }
      }
    }
  }

  if (!isObj(input.meta)) issues.add('meta', 'must be { name, created, project? }')
  else {
    if (typeof input.meta.name !== 'string') issues.add('meta.name', 'must be a string')
    if (typeof input.meta.created !== 'string') issues.add('meta.created', 'must be an ISO date string')
  }

  if (issues.list.length) return { ok: false, issues: issues.list, warnings: warnings.list }
  return { ok: true, value: input as unknown as Preset, issues: [], warnings: warnings.list }
}

export function validateFamily(input: unknown): ValidationResult<Family> {
  const issues = new Issues()
  if (!isObj(input)) {
    return { ok: false, issues: [{ path: '', message: 'family must be an object' }], warnings: [] }
  }
  if (input.schema !== 2) issues.add('schema', 'must be 2')
  if (typeof input.shader !== 'string' || !SHADER_ID.test(input.shader)) {
    issues.add('shader', 'must be a versioned id like masses@1')
  }
  issues.num(input, 'variety', '', 0, 1)
  if (!isObj(input.base)) issues.add('base', 'must be { value: [min, max], chromaMax }')
  else {
    issues.range(input.base, 'value', 'base', L_MIN, L_MAX)
    issues.num(input.base, 'chromaMax', 'base', 0, 0.4)
  }
  if (!isObj(input.masses)) {
    issues.add('masses', 'must be { count, size, softness, x, y, chromaMax, boldMax, boldAllowed }')
  } else {
    issues.range(input.masses, 'count', 'masses', 1, MAX_MASSES)
    issues.range(input.masses, 'size', 'masses', 0.05, 4)
    issues.range(input.masses, 'softness', 'masses', 0, 1)
    issues.range(input.masses, 'x', 'masses', -1, 3)
    issues.range(input.masses, 'y', 'masses', -1, 2)
    issues.num(input.masses, 'chromaMax', 'masses', 0, 0.4)
    issues.num(input.masses, 'boldMax', 'masses', 0, 0.4)
    issues.bool(input.masses, 'boldAllowed', 'masses')
  }
  if (!isObj(input.texture)) issues.add('texture', 'must be { grain, range, animate }')
  else {
    issues.num(input.texture, 'grain', 'texture', 0, 0.5)
    issues.range(input.texture, 'range', 'texture', 0, 0.5)
    issues.bool(input.texture, 'animate', 'texture')
  }
  if (!isObj(input.motion)) issues.add('motion', 'must be { driftRadius, driftRange, speed, angle }')
  else {
    issues.num(input.motion, 'driftRadius', 'motion', 0, 0.5)
    issues.range(input.motion, 'driftRange', 'motion', 0, 0.5)
    issues.num(input.motion, 'angle', 'motion', -360, 360)
    issues.num(input.motion, 'speed', 'motion', 1, 8)
    if (isNum(input.motion.speed) && !Number.isInteger(input.motion.speed)) {
      issues.add('motion.speed', 'must be a whole number of revolutions per loop, or the loop will not join')
    }
  }
  issues.num(input, 'captionZone', '', 0, 0.6)
  if (!isObj(input.finish) || !isObj(input.finish.motionBlur) || !isObj(input.finish.layerBlur)) {
    issues.add('finish', 'must be { motionBlur: { allowed, length, intensity }, layerBlur: { allowed, radius, intensity } }')
  } else {
    const m = input.finish.motionBlur
    issues.bool(m, 'allowed', 'finish.motionBlur')
    issues.range(m, 'length', 'finish.motionBlur', 0, 0.3)
    issues.range(m, 'intensity', 'finish.motionBlur', 0, 1)
    const l = input.finish.layerBlur
    issues.bool(l, 'allowed', 'finish.layerBlur')
    issues.range(l, 'radius', 'finish.layerBlur', 0, 0.15)
    issues.range(l, 'intensity', 'finish.layerBlur', 0, 1)
  }
  if (!isObj(input.depth)) issues.add('depth', 'must list the six layers')
  else {
    for (const layer of DEPTH_ORDER) {
      const v = input.depth[layer]
      if (!isObj(v)) {
        issues.add(`depth.${layer}`, 'must be { on, allowed, amount: [min, max] }')
        continue
      }
      issues.bool(v, 'on', `depth.${layer}`)
      issues.bool(v, 'allowed', `depth.${layer}`)
      issues.range(v, 'amount', `depth.${layer}`, 0, 1)
      if (layer === 'relief') {
        issues.num(v, 'frequency', 'depth.relief', 1, 400)
        issues.num(v, 'twist', 'depth.relief', -90, 90)
      }
    }
  }
  if (!isObj(input.meta) || typeof input.meta.name !== 'string' || typeof input.meta.created !== 'string') {
    issues.add('meta', 'must be { name, created }')
  }
  if (issues.list.length) return { ok: false, issues: issues.list, warnings: [] }
  return { ok: true, value: input as unknown as Family, issues: [], warnings: [] }
}

/** Clamps a number into a range. */
export const clampTo = (v: number, [min, max]: Range) => Math.min(max, Math.max(min, v))

export const describe = (issues: ValidationIssue[]) => issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')
