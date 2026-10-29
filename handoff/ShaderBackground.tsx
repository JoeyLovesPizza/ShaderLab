import { useEffect, useRef, type CSSProperties } from 'react'
import { useCardGlow } from '../ui'

interface ShaderBackgroundProps {
  /** Project id from src/data/projects.ts; resolves to /work/shaders/card-<id>.webp. */
  id: string
  /** Light the card's glow from this image instead of the artwork above it. */
  glow?: boolean
  /** For parallax: transform this layer independently of the artwork. */
  style?: CSSProperties
  className?: string
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
 */
export function ShaderBackground({ id, glow = false, style, className }: ShaderBackgroundProps) {
  const ref = useRef<HTMLImageElement>(null)
  const paintGlow = useCardGlow()

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
