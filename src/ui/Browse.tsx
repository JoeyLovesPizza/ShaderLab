import type { Preset } from '../model/types'
import type { BrowseView } from '../states/machine'
import { CardBoundary } from './CardBoundary'
import { Cell, type CellFocus } from './Cell'

/*
 * Browse (SPEC.md §6): the library as a grid of thumbnails, or as a rail
 * of cards at card scale with their auras on #fafafa, where the family is
 * judged. Both show every card in file order; the one that is focused
 * keeps its place here and flies out of it.
 */

interface BrowseProps {
  view: BrowseView
  presets: Preset[]
  reduced: boolean
  focusedId: string | null
  focus: CellFocus
  onSelect: (presetId: string) => void
  onHover: (presetId: string | null) => void
  /** An image dropped on a card, or on the grid (for the active card). */
  onPhotoDrop: (presetId: string | null, file: File) => void
}

export function Browse({ view, presets, reduced, focusedId, focus, onSelect, onHover, onPhotoDrop }: BrowseProps) {
  return (
    <section
      className={view === 'rail' ? 'rail' : 'grid'}
      aria-label={view === 'rail' ? 'Rail' : 'Grid'}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
        if (!file) return
        e.preventDefault()
        onPhotoDrop(null, file)
      }}
    >
      {presets.map((preset) => (
        <CardBoundary key={preset.id} label={preset.meta.name}>
          <Cell
            preset={preset}
            aura={view === 'rail'}
            reduced={reduced}
            focus={preset.id === focusedId ? focus : null}
            onSelect={onSelect}
            onHover={onHover}
            onPhotoDrop={onPhotoDrop}
          />
        </CardBoundary>
      ))}
    </section>
  )
}
