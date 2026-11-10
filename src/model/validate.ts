import {
  CARD_MOTION_DEFAULT,
  COLOUR_MODES,
  COVERAGE_MODES,
  DEPTH_ORDER,
  DEFAULT_SPREAD,
  L_MAX,
  L_MIN,
  LINK_PATHS,
  MASS_KINDS,
  MASS_MOTION_DEFAULT,
  MASS_PATHS,
  MAX_MASSES,
  STRUCTURE_LAYERS,
  STRUCTURE_MODES,
  type CardDraft,
  type Family,
  type LinkPath,
  type Mass,
  type Preset,
  type Project,
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
    issues.add(path, `must be { on, ${path.endsWith('light') ? 'height' : 'amount'} }`)
    return null
  }
  issues.bool(value, 'on', path)
  // Light carries a height, not an amount: it scales the field it shades,
  // up to 2 (the Critic: at 0.5 a soft mass's normal barely tilted).
  if (path.endsWith('light')) issues.num(value, 'height', path, 0, 2)
  else issues.num(value, 'amount', path, 0, 1)
  return value
}

/** Depth parameters added after the first files; filled when missing. */
const SWIRL_SCALE_DEFAULT = 0.6
const STROKES_DEFAULT = { direction: 20, followAngle: true, size: 0.35, density: 14, taper: 0.25, chaos: 0, follow: 0.3, motion: 0.5 }

/** Fields added after the first files were written take their defaults
    when missing, so an older file still loads as it did. */
const FINISH_DEFAULT = {
  motionBlur: { on: false, angle: 20, followAngle: true, length: 0.1, intensity: 0.6 },
  layerBlur: { on: false, radius: 0.04, intensity: 0.6 },
}

/** A depth layer that an older file does not have: off, at nothing. */
const LAYER_DEFAULT: Record<string, Obj> = {
  light: { on: false, height: 0.5 },
  curve: { on: false, amount: 0 },
  parallax: { on: false, amount: 0 },
  haze: { on: false, amount: 0 },
  swirl: { on: false, amount: 0, scale: 0.6 },
  relief: { on: false, amount: 0, frequency: 85, twist: 6 },
  strokes: { on: false, amount: 0.018, direction: 20, followAngle: true, size: 0.35, density: 14, taper: 0.25, chaos: 0, follow: 0.3, motion: 0.5 },
  shadow: { on: false, amount: 0, rect: [0, 0, 1, 1], offset: 0, spread: 0 },
}

/*
 * Migration, before the checks: a file written under an earlier version
 * of the schema loads with warnings, never as invalid. A structure mode
 * that no longer exists ("grid") becomes "none"; a depth key that no
 * longer exists is dropped; a depth layer or finish stage added since is
 * filled from its default. Only shapes that were never valid fail.
 */
function withDefaults(input: Obj, warnings: Issues): Obj {
  const out: Obj = { ...input }
  // Projects arrived 2026-11-06: a background with none is its own project.
  if (out.project === undefined && typeof out.id === 'string' && out.id) {
    warnings.add('project', `missing; read as its own project "${out.id}"`)
    out.project = out.id
  }
  out.overrides = cleanOverrides(out.overrides, warnings)
  // Variation seeds arrived 2026-11-10: a background without one equals its project.
  if (out.variation === undefined) {
    warnings.add('variation', 'missing; read as none (linked stages equal the project style)')
    out.variation = null
  }
  // Card motion arrived 2026-11-10 (family version 10): before it every
  // card moved by the family's one Motion dial, 0.6 in every family file,
  // which is travel 0.6 at two revolutions a loop.
  if (out.motion === undefined) {
    warnings.add('motion', `missing; read as travel ${CARD_MOTION_DEFAULT.travel}, tempo ${CARD_MOTION_DEFAULT.tempo} (the old family motion)`)
    out.motion = { ...CARD_MOTION_DEFAULT }
  } else if (isObj(out.motion)) out.motion = { ...CARD_MOTION_DEFAULT, ...out.motion }
  if (isObj(out.modes)) {
    const m = out.modes
    if (typeof m.structure === 'string' && !STRUCTURE_MODES.includes(m.structure as never)) {
      warnings.add('modes.structure', `"${m.structure}" is no longer a structure; read as "none"`)
      out.modes = { ...m, structure: 'none' }
    }
  }
  if (isObj(out.depth)) {
    const depth: Obj = {}
    for (const layer of DEPTH_ORDER) {
      if (out.depth[layer] === undefined) {
        warnings.add(`depth.${layer}`, 'missing; read as off')
        depth[layer] = structuredClone(LAYER_DEFAULT[layer])
      } else depth[layer] = out.depth[layer]
    }
    // Parameters that arrived after the first files: a swirl without its
    // scale is the original marbling; strokes without their shape take
    // the family's.
    if (isObj(depth.swirl) && depth.swirl.scale === undefined) depth.swirl = { ...depth.swirl, scale: SWIRL_SCALE_DEFAULT }
    if (isObj(depth.strokes)) {
      // followField (2026-11-02, one round) is gone: strokes keep a direction.
      const { followField: _followField, length, ...strokes } = depth.strokes
      if (_followField !== undefined) warnings.add('depth.strokes.followField', 'no longer exists; the key was ignored')
      // The fibre model (2026-11-02/03) had a fibre length and fibres per
      // height; marks have a size and cells per width. The length carries
      // over as the mark size; the old density does not translate.
      const marks: Obj = { ...STROKES_DEFAULT, ...strokes }
      if (length !== undefined && strokes.size === undefined) {
        marks.size = length
        warnings.add('depth.strokes.length', 'is now size (a mark\'s length in card widths)')
      }
      if (isNum(strokes.density) && strokes.density > 60) {
        marks.density = STROKES_DEFAULT.density
        warnings.add('depth.strokes.density', 'was fibres per height; read as the default cells per width')
      }
      depth.strokes = marks
    }
    for (const key of Object.keys(out.depth)) {
      if (!(DEPTH_ORDER as readonly string[]).includes(key)) {
        warnings.add(`depth.${key}`, 'no such layer; the key was ignored')
      }
    }
    out.depth = depth
  }
  const f = isObj(out.finish) ? out.finish : {}
  out.finish = {
    motionBlur: { ...FINISH_DEFAULT.motionBlur, ...(isObj(f.motionBlur) ? f.motionBlur : {}) },
    layerBlur: { ...FINISH_DEFAULT.layerBlur, ...(isObj(f.layerBlur) ? f.layerBlur : {}) },
  }
  return out
}

/** An overrides list as the schema wants it: only known LinkPaths, once
    each, in LINK_PATHS order. A missing list is empty; an unknown path is
    dropped with a warning, so an old name never makes a file invalid. */
export function cleanOverrides(value: unknown, warnings?: Issues): LinkPath[] {
  if (value === undefined) {
    warnings?.add('overrides', 'missing; read as none (every stage follows the project)')
    return []
  }
  if (!Array.isArray(value)) {
    warnings?.add('overrides', 'must be a list of stage paths; read as none')
    return []
  }
  const known = new Set<string>(LINK_PATHS)
  const keep = new Set<string>()
  for (const p of value) {
    if (typeof p === 'string' && known.has(p)) keep.add(p)
    else warnings?.add('overrides', `"${String(p)}" is not a linkable stage; dropped`)
  }
  return LINK_PATHS.filter((p) => keep.has(p))
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

function checkColour(issues: Issues, value: Obj, path: string) {
  issues.num(value, 'hue', path, 0, 360)
  issues.num(value, 'value', path, L_MIN, L_MAX)
  issues.num(value, 'chroma', path, 0, 0.4)
}

function checkPoint(issues: Issues, value: unknown, path: string) {
  if (!isObj(value)) {
    issues.add(path, 'must be { x, y }')
    return
  }
  issues.num(value, 'x', path, -1, 3)
  issues.num(value, 'y', path, -1, 2)
}

/**
 * The ridge kind arrived after the first files: a mass without a kind is
 * a blob, and a blob's unused path and ramp are filled so every mass has
 * the one shape (the panel shows them for the Kind switch).
 */
function withMassDefaults(value: Obj, at: string, warnings: Issues): Obj {
  const kind = value.kind === 'ridge' ? 'ridge' : 'blob'
  const x = isNum(value.x) ? value.x : 0
  const y = isNum(value.y) ? value.y : 0
  const colour = { hue: value.hue, value: value.value, chroma: value.chroma }
  const path = isObj(value.path) ? value.path : {}
  const ramp = isObj(value.ramp) ? value.ramp : {}
  return {
    ...value,
    kind,
    // The quadratic form (one round, 2026-11-02) had the mass position as
    // its one control point: both cubic controls land there.
    path: {
      start: path.start ?? { x: x - 0.4, y: y - 0.2 },
      control1: path.control1 ?? { x, y },
      control2: path.control2 ?? path.control1 ?? { x, y },
      end: path.end ?? { x: x + 0.4, y: y + 0.2 },
    },
    ramp: { start: ramp.start ?? { ...colour }, end: ramp.end ?? { ...colour }, fieldMix: ramp.fieldMix ?? 0 },
    // Mass motion arrived 2026-11-10: a mass without it drifts on today's circle.
    motion: motionWithDefaults(value.motion, at, warnings),
  }
}

function motionWithDefaults(value: unknown, path: string, warnings: Issues): unknown {
  if (value === undefined) {
    warnings.add(`${path}.motion`, 'missing; read as a circle at the card\'s travel (the old drift)')
    return { ...MASS_MOTION_DEFAULT }
  }
  return isObj(value) ? { ...MASS_MOTION_DEFAULT, ...value } : value
}

function checkCardMotion(issues: Issues, value: unknown, path: string) {
  if (!isObj(value)) {
    issues.add(path, 'must be { travel, tempo }')
    return
  }
  issues.num(value, 'travel', path, 0, 1)
  issues.num(value, 'tempo', path, 1, 4)
  if (isNum(value.tempo) && !Number.isInteger(value.tempo)) issues.add(`${path}.tempo`, 'must be a whole number of revolutions per loop, or the loop will not join')
}

function checkMass(issues: Issues, value: unknown, path: string): value is Mass {
  if (!isObj(value)) {
    issues.add(path, 'must be a mass')
    return false
  }
  if (!MASS_KINDS.includes(value.kind as never)) issues.add(`${path}.kind`, `must be one of ${MASS_KINDS.join(', ')}`)
  checkColour(issues, value, path)
  issues.num(value, 'x', path, -1, 3)
  issues.num(value, 'y', path, -1, 2)
  issues.num(value, 'size', path, 0.05, 4)
  issues.num(value, 'softness', path, 0, 1)
  issues.num(value, 'distance', path, 0, 1)
  issues.bool(value, 'locked', path)
  if (!isObj(value.path)) issues.add(`${path}.path`, 'must be { start, control1, control2, end }')
  else {
    for (const key of ['start', 'control1', 'control2', 'end']) checkPoint(issues, value.path[key], `${path}.path.${key}`)
  }
  if (!isObj(value.ramp) || !isObj(value.ramp.start) || !isObj(value.ramp.end)) issues.add(`${path}.ramp`, 'must be { start, end } colours')
  else {
    checkColour(issues, value.ramp.start, `${path}.ramp.start`)
    checkColour(issues, value.ramp.end, `${path}.ramp.end`)
    issues.num(value.ramp, 'fieldMix', `${path}.ramp`, 0, 1)
  }
  if (!isObj(value.motion)) issues.add(`${path}.motion`, 'must be { path, travel, angle, pulse, shift }')
  else {
    const m = value.motion
    if (!MASS_PATHS.includes(m.path as never)) issues.add(`${path}.motion.path`, `must be one of ${MASS_PATHS.join(', ')}`)
    issues.num(m, 'travel', `${path}.motion`, 0, 2)
    issues.num(m, 'angle', `${path}.motion`, -360, 360)
    issues.num(m, 'pulse', `${path}.motion`, 0, 0.3)
    issues.num(m, 'shift', `${path}.motion`, 0, 40)
  }
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

  if (typeof input.project !== 'string' || !input.project) issues.add('project', 'must be a non-empty string (the project id)')

  issues.num(input, 'seed', '', 0)
  if (input.variation !== null && !(isNum(input.variation) && input.variation >= 0)) issues.add('variation', 'must be null or a seed (a number from 0)')

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
    const masses: unknown[] = input.masses.map((mass: unknown, i: number) => (isObj(mass) ? withMassDefaults(mass, `masses.${i}`, warnings) : mass))
    input.masses = masses
    masses.forEach((mass, i) => checkMass(issues, mass, `masses.${i}`))
  }

  if (!isObj(input.texture)) issues.add('texture', 'must be { grain }')
  else issues.num(input.texture, 'grain', 'texture', 0, 0.5)

  checkCardMotion(issues, input.motion, 'motion')

  if (!isObj(input.depth)) issues.add('depth', `must be { ${DEPTH_ORDER.join(', ')} }`)
  else {
    for (const layer of DEPTH_ORDER) {
      const v = checkLayer(issues, input.depth[layer], `depth.${layer}`)
      if (!v) continue
      if (layer === 'swirl') issues.num(v, 'scale', 'depth.swirl', 0.1, 3)
      if (layer === 'relief') {
        issues.num(v, 'frequency', 'depth.relief', 1, 400)
        issues.num(v, 'twist', 'depth.relief', -90, 90)
      }
      if (layer === 'strokes') {
        issues.num(v, 'direction', 'depth.strokes', -360, 360)
        issues.bool(v, 'followAngle', 'depth.strokes')
        issues.num(v, 'size', 'depth.strokes', 0.05, 2)
        issues.num(v, 'density', 'depth.strokes', 2, 60)
        issues.num(v, 'taper', 'depth.strokes', 0, 0.5)
        issues.num(v, 'chaos', 'depth.strokes', 0, 1)
        issues.num(v, 'follow', 'depth.strokes', 0, 1)
        issues.num(v, 'motion', 'depth.strokes', 0, 1)
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
    // Of Swirl, Relief and Strokes at most one may be on (SPEC.md §4).
    const depth = input.depth
    const structuresOn = STRUCTURE_LAYERS.filter((name) => {
      const layer = depth[name]
      return isObj(layer) && layer.on === true
    })
    if (structuresOn.length > 1) {
      issues.add('depth', `only one of ${STRUCTURE_LAYERS.join(', ')} may be on; ${structuresOn.join(' and ')} are`)
    }
  }

  issues.bool(input, 'captionMask', '')

  // The photo arrived 2026-11-04: a file or overlay without one has none.
  if (input.photo === undefined) input.photo = null
  if (input.photo !== null) {
    if (!isObj(input.photo)) issues.add('photo', 'must be null or { src, fidelity }')
    else {
      const src = input.photo.src
      if (typeof src !== 'string' || !src) issues.add('photo.src', 'must be a path under presets/')
      else if (src.startsWith('data:')) issues.add('photo.src', 'must be a path, never a data URL')
      issues.num(input.photo, 'fidelity', 'photo', 0, 1)
    }
  }
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

/** What a project's stages are checked against: the preset rules, with
    fixed, valid values for everything a project does not carry. */
const PROJECT_SCAFFOLD = {
  schema: 2,
  id: 'project',
  project: 'project',
  overrides: [],
  variation: null,
  shader: 'masses@1',
  canvas: { width: 613, height: 408, dpr: 2 },
  loop: { seconds: 12, fps: 30, stillTime: 6 },
  seed: 0,
  captionMask: false,
  image: null,
  photo: null,
  meta: { name: 'project', created: '2026-01-01' },
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/

/** Checks an unknown JSON value as a project file (SPEC.md §4). Never
    throws. The style is held to the same rules as a card's stages, by
    running them through validatePreset on a scaffold. */
export function validateProject(raw: unknown): ValidationResult<Project> {
  const issues = new Issues()
  const warnings: ValidationIssue[] = []
  if (!isObj(raw)) {
    return { ok: false, issues: [{ path: '', message: 'project must be an object' }], warnings: [] }
  }
  if (raw.schema !== 2) issues.add('schema', 'must be 2')
  if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) issues.add('id', 'must be a slug')
  if (typeof raw.name !== 'string') issues.add('name', 'must be a string')
  let spread = raw.spread
  if (spread === undefined) {
    warnings.push({ path: 'spread', message: `missing; read as ${DEFAULT_SPREAD}` })
    spread = DEFAULT_SPREAD
  }
  issues.num({ spread }, 'spread', '', 0, 1)
  if (typeof raw.primary !== 'string' || !raw.primary) issues.add('primary', 'must be the id of a background')
  if (!isObj(raw.meta) || typeof raw.meta.created !== 'string') issues.add('meta', 'must be { created }')

  let style: unknown
  if (!isObj(raw.style)) issues.add('style', 'must be { base, masses, texture, modes, motion, depth }')
  else {
    const { base, masses, texture, modes, motion, depth } = raw.style
    const result = validatePreset({ ...PROJECT_SCAFFOLD, base, masses, texture, modes, motion, depth })
    for (const w of result.warnings) warnings.push({ path: `style.${w.path}`, message: w.message })
    if (!result.ok) for (const i of result.issues) issues.add(`style.${i.path}`, i.message)
    else {
      const v = result.value
      style = { base: v.base, masses: v.masses, texture: v.texture, modes: v.modes, motion: v.motion, depth: v.depth }
    }
  }

  if (issues.list.length) return { ok: false, issues: issues.list, warnings }
  return {
    ok: true,
    value: { schema: 2, id: raw.id as string, name: raw.name as string, spread: spread as number, primary: raw.primary as string, style, meta: { created: (raw.meta as Obj).created as string } } as Project,
    issues: [],
    warnings,
  }
}

export function validateFamily(raw: unknown): ValidationResult<Family> {
  const issues = new Issues()
  if (!isObj(raw)) {
    return { ok: false, issues: [{ path: '', message: 'family must be an object' }], warnings: [] }
  }
  // A copy, so a default filled in below never touches the imported JSON.
  const input: Obj = { ...raw }
  if (input.schema !== 2) issues.add('schema', 'must be 2')
  if (typeof input.shader !== 'string' || !SHADER_ID.test(input.shader)) {
    issues.add('shader', 'must be a versioned id like masses@1')
  }
  issues.num(input, 'variety', '', 0, 1)
  // The house pull arrived with projects (2026-11-06).
  if (input.housePull === undefined) input.housePull = 0.5
  issues.num(input, 'housePull', '', 0, 1)
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
  if (!isObj(input.motion)) issues.add('motion', 'must be { driftRadius, travel, tempo, travelRange, tempoRange, mass, angle }')
  else {
    // Before version 10 the family carried one Motion dial (`amount`,
    // scaling the drift about 0.6) and `speed`; they become the house
    // default travel and tempo. The ranges take SPEC.md's defaults.
    const { amount, speed: _speed, driftRange: _driftRange, ...rest } = input.motion
    const old = isNum(amount) ? amount : 0.6
    const motion: Obj = {
      travel: old,
      tempo: old < 0.45 ? 1 : old < 0.85 ? 2 : 3,
      ...MOTION_RANGES_DEFAULT,
      ...rest,
    }
    motion.mass = { ...MOTION_RANGES_DEFAULT.mass, ...(isObj(rest.mass) ? rest.mass : {}) }
    input.motion = motion
    issues.num(motion, 'driftRadius', 'motion', 0, 0.5)
    issues.num(motion, 'angle', 'motion', -360, 360)
    issues.num(motion, 'travel', 'motion', 0, 1)
    issues.num(motion, 'tempo', 'motion', 1, 4)
    issues.range(motion, 'travelRange', 'motion', 0, 1)
    issues.range(motion, 'tempoRange', 'motion', 1, 4)
    if (isNum(motion.tempo) && !Number.isInteger(motion.tempo)) issues.add('motion.tempo', 'must be a whole number of revolutions per loop, or the loop will not join')
    const tr = motion.tempoRange
    if (Array.isArray(tr) && !tr.every((n) => Number.isInteger(n))) issues.add('motion.tempoRange', 'must be whole revolutions per loop')
    const mass = motion.mass as Obj
    if (!Array.isArray(mass.paths) || !mass.paths.length || !mass.paths.every((p) => MASS_PATHS.includes(p as never))) {
      issues.add('motion.mass.paths', `must list some of ${MASS_PATHS.join(', ')}`)
    }
    issues.range(mass, 'travel', 'motion.mass', 0, 2)
    issues.range(mass, 'pulse', 'motion.mass', 0, 0.3)
    issues.range(mass, 'shift', 'motion.mass', 0, 40)
  }
  issues.num(input, 'captionZone', '', 0, 0.6)
  // The light arrived after the first families; an older file gets the
  // SPEC.md defaults (from the family's angle, 35° up, amount 0.2).
  const light: Obj = { angle: 90, followAngle: false, elevation: 30, amount: 0.2, ...(isObj(input.light) ? input.light : {}) }
  input.light = light
  issues.num(light, 'angle', 'light', -360, 360)
  issues.bool(light, 'followAngle', 'light')
  issues.num(light, 'elevation', 'light', 5, 90)
  issues.num(light, 'amount', 'light', 0, 0.5)
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
  if (!isObj(input.depth)) issues.add('depth', `must list the layers: ${DEPTH_ORDER.join(', ')}`)
  else {
    // Layers added after the first families take SPEC.md's defaults.
    const depth: Obj = {
      light: { on: true, allowed: true, amount: [1, 2] },
      strokes: { on: false, allowed: true, amount: [0.01, 0.03], size: 0.35, density: 14 },
      ...input.depth,
    }
    if (isObj(depth.swirl) && depth.swirl.scale === undefined) depth.swirl = { ...depth.swirl, scale: SWIRL_SCALE_DEFAULT }
    input.depth = depth
    for (const layer of DEPTH_ORDER) {
      const v = depth[layer]
      if (!isObj(v)) {
        issues.add(`depth.${layer}`, 'must be { on, allowed, amount: [min, max] }')
        continue
      }
      issues.bool(v, 'on', `depth.${layer}`)
      issues.bool(v, 'allowed', `depth.${layer}`)
      issues.range(v, 'amount', `depth.${layer}`, 0, layer === 'light' ? 2 : 1)
      if (layer === 'swirl') issues.num(v, 'scale', 'depth.swirl', 0.1, 3)
      if (layer === 'relief') {
        issues.num(v, 'frequency', 'depth.relief', 1, 400)
        issues.num(v, 'twist', 'depth.relief', -90, 90)
      }
      if (layer === 'strokes') {
        // Older families carried a fibre length and density.
        if (v.size === undefined) v.size = isNum(v.length) ? v.length : 0.35
        if (!isNum(v.density) || v.density > 60) v.density = 14
        issues.num(v, 'size', 'depth.strokes', 0.05, 2)
        issues.num(v, 'density', 'depth.strokes', 2, 60)
      }
    }
  }
  if (!isObj(input.meta) || typeof input.meta.name !== 'string' || typeof input.meta.created !== 'string') {
    issues.add('meta', 'must be { name, created }')
  }
  if (issues.list.length) return { ok: false, issues: issues.list, warnings: [] }
  return { ok: true, value: input as unknown as Family, issues: [], warnings: [] }
}

/** The house's motion ranges when a family file has none (before version 10). */
const MOTION_RANGES_DEFAULT = {
  travelRange: [0.35, 0.85],
  tempoRange: [1, 3],
  mass: { paths: [...MASS_PATHS], travel: [0.6, 1.5], pulse: [0, 0.15], shift: [0, 18] },
}

/** Clamps a number into a range. */
export const clampTo = (v: number, [min, max]: Range) => Math.min(max, Math.max(min, v))

export const describe = (issues: ValidationIssue[]) => issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')

const DRAFT_KEYS = ['seed', 'modes', 'base', 'masses', 'texture', 'depth', 'motion', 'finish', 'captionMask', 'loop', 'photo'] as const

/**
 * An overlay (a card's draft from localStorage, or a library card) is a
 * file from an earlier session: it goes through the same validation and
 * migration as a file, laid over the card's own preset. The draft that
 * comes back has every field the current schema has; nothing renders or
 * packs a draft that has not been through here. Null when it still does
 * not validate, so the caller falls back to the file.
 */
export function migrateOverlay(preset: Preset, overlay: unknown): { draft: CardDraft; warnings: ValidationIssue[] } | null {
  if (!isObj(overlay)) return null
  const candidate: Obj = { ...(preset as unknown as Obj) }
  for (const key of DRAFT_KEYS) if (overlay[key] !== undefined) candidate[key] = overlay[key]
  const result = validatePreset(candidate)
  if (!result.ok) return null
  const p = result.value as unknown as Obj
  const draft = Object.fromEntries(DRAFT_KEYS.map((k) => [k, p[k]])) as unknown as CardDraft
  return { draft: structuredClone(draft), warnings: result.warnings }
}
