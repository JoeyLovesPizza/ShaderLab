import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useCardGlow } from '../ui'

interface ShaderBackgroundCommon {
  /** Light the card's glow from this image instead of the artwork above it. */
  glow?: boolean
  /** For parallax: transform this layer independently of the artwork. */
  style?: CSSProperties
  className?: string
}

/** Exactly one of `id` or `project`: a background by id, or a project's pick. */
type ShaderBackgroundProps = ShaderBackgroundCommon &
  (
    | {
        /** Background id from backgrounds.json; resolves to /work/shaders/card-<id>.webp. */
        id: string
        project?: never
        variant?: never
      }
    | {
        id?: never
        /** Project id from backgrounds.json `projects`; renders its primary unless `variant` says otherwise. */
        project: string
        /** Index into the project's `backgrounds` (0 = primary). Out of range falls back to the primary. */
        variant?: number
      }
  )

/** Manifest copy, fetched once per page; only `project` cards need it. */
let projectsPromise: Promise<Record<string, string[]>> | undefined
function loadProjects(): Promise<Record<string, string[]>> {
  projectsPromise ??= fetch('/shaders/backgrounds.json')
    .then((r) => r.json() as Promise<{ projects: { id: string; backgrounds: string[] }[] }>)
    .then((m) => Object.fromEntries(m.projects.map((p) => [p.id, p.backgrounds])))
    .catch(() => ({}))
  return projectsPromise
}

/*
 * One ShaderLab background on a card's art layer. See ShaderLab/handoff/README.md.
 *
 * It is an art asset, not a card: it fills the art box absolutely and whatever
 * comes after it in the DOM paints on top. The mask layer (the Carousel's card
 * surface) clips and transforms it with the rest of the art.
 *
 * With `glow` it feeds useCardGlow itself, the same channel CaseStudyImage and
 * VideoLoop use, so the aura behind the card takes the background's colour.
 * The backgrounds are rendered with a lit region bright enough for that aura
 * to read on the page.
 *
 * `id` names a background. `project` names a project and shows its primary;
 * `variant` picks an alternate by index. A project card renders nothing
 * until the manifest has loaded, then the image, so there is no wrong flash.
 */
export function ShaderBackground({ id: byId, project, variant = 0, glow = false, style, className }: ShaderBackgroundProps) {
  const ref = useRef<HTMLImageElement>(null)
  const paintGlow = useCardGlow()
  const [ids, setIds] = useState<string[] | undefined>()

  useEffect(() => {
    if (!project) return
    let live = true
    loadProjects().then((all) => {
      if (live) setIds(all[project])
    })
    return () => {
      live = false
    }
  }, [project])

  let id = byId
  if (project && ids) {
    if (variant < 0 || variant >= ids.length) {
      if (import.meta.env.DEV) console.warn(`ShaderBackground: project "${project}" has no variant ${variant}; showing the primary`)
      id = ids[0]
    } else {
      id = ids[variant]
    }
  }

  useEffect(() => {
    const el = ref.current
    if (!glow || !el || !paintGlow) return
    if (el.complete) {
      paintGlow(el)
      return
    }
    const onLoad = () => paintGlow(el)
    el.addEventListener('load', onLoad)
    return () => el.removeEventListener('load', onLoad)
  }, [id, glow, paintGlow])

  if (!id) return null

  return (
    <img
      ref={ref}
      className={className ? `shader-background ${className}` : 'shader-background'}
      src={`/work/shaders/card-${id}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={style}
    />
  )
}
