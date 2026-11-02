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
}

export function Browse({ view, presets, reduced, focusedId, focus, onSelect, onHover }: BrowseProps) {
  return (
    <section className={view === 'rail' ? 'rail' : 'grid'} aria-label={view === 'rail' ? 'Rail' : 'Grid'}>
      {presets.map((preset) => (
        <CardBoundary key={preset.id} label={preset.meta.name}>
          <Cell
            preset={preset}
            aura={view === 'rail'}
            reduced={reduced}
            focus={preset.id === focusedId ? focus : null}
            onSelect={onSelect}
            onHover={onHover}
          />
        </CardBoundary>
      ))}
    </section>
  )
}
