import type { Preset } from '../model/types'
import type { BrowseView } from '../states/machine'
import { CardBoundary } from './CardBoundary'
import { Cell, type CellFocus } from './Cell'

/*
 * Browse (SPEC.md §6): the grid of every preset, or the rail of the six
 * carousel cards at card scale with their auras on #fafafa, where the
 * family is judged. Both are the same Cells; the one that is focused keeps
 * its place here and flies out of it.
 */

interface BrowseProps {
  view: BrowseView
  presets: Preset[]
  railPresets: Preset[]
  reduced: boolean
  focusedId: string | null
  focus: CellFocus
  onSelect: (presetId: string) => void
  onHover: (presetId: string | null) => void
}

export function Browse({ view, presets, railPresets, reduced, focusedId, focus, onSelect, onHover }: BrowseProps) {
  const list = view === 'rail' ? railPresets : presets
  return (
    <section className={view === 'rail' ? 'rail' : 'grid'} aria-label={view === 'rail' ? 'Rail' : 'Grid'}>
      {list.map((preset) => (
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
