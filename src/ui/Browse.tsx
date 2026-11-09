import { getLink } from '../model/cards'
import { useProjects } from '../model/projects'
import type { Preset } from '../model/types'
import type { BrowseView } from '../states/machine'
import { CardBoundary } from './CardBoundary'
import { Cell, type CellFocus } from './Cell'

/*
 * Browse (SPEC.md §4, §6): the library grouped by project, in the order of
 * each project's first card, as a grid of thumbnails or as one rail of
 * cards at card scale per project (auras on #fafafa), where the family is
 * judged. A group's header names the project and carries its two actions;
 * its primary background comes first. The one that is focused keeps its
 * place in its group and flies out of it.
 */

interface BrowseProps {
  view: BrowseView
  presets: Preset[]
  reduced: boolean
  focusedId: string | null
  focus: CellFocus
  onSelect: (presetId: string) => void
  onHover: (presetId: string | null) => void
  /** An image dropped on a card, or on the page (for the active card). */
  onPhotoDrop: (presetId: string | null, file: File) => void
  onNewBackground: (projectId: string) => void
  onShuffleProject: (projectId: string) => void
}

interface Group {
  id: string
  cards: Preset[]
}

/** Groups in the order of each project's first card; cards in file order. */
function groupByProject(presets: Preset[]): Group[] {
  const groups = new Map<string, Group>()
  for (const preset of presets) {
    const id = getLink(preset.id).project
    const group = groups.get(id) ?? { id, cards: [] }
    group.cards.push(preset)
    groups.set(id, group)
  }
  return [...groups.values()]
}

export function Browse({
  view,
  presets,
  reduced,
  focusedId,
  focus,
  onSelect,
  onHover,
  onPhotoDrop,
  onNewBackground,
  onShuffleProject,
}: BrowseProps) {
  const projects = useProjects()
  const rail = view === 'rail'
  return (
    <section
      className="browse"
      aria-label={rail ? 'Rail' : 'Grid'}
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
      {groupByProject(presets).map((group) => {
        const project = projects.find((p) => p.id === group.id)
        const name = project?.name ?? group.cards[0].meta.name
        // Primary first; the rest keep their file order.
        const cards = project
          ? [...group.cards.filter((c) => c.id === project.primary), ...group.cards.filter((c) => c.id !== project.primary)]
          : group.cards
        const many = cards.length > 1
        return (
          <div key={group.id} className="project" role="group" aria-label={name}>
            <header className="project__head">
              <h2 className="project__name">{name}</h2>
              <span className="project__meta">
                {cards.length} {cards.length === 1 ? 'background' : 'backgrounds'}
              </span>
              <span className="project__meta">Spread {(project?.spread ?? 0).toFixed(2)}</span>
              <span className="project__actions">
                <button type="button" className="project__btn" onClick={() => onNewBackground(group.id)}>
                  New background
                </button>
                <button type="button" className="project__btn" onClick={() => onShuffleProject(group.id)}>
                  Shuffle project
                </button>
              </span>
            </header>
            <div className={rail ? 'rail' : 'grid'}>
              {cards.map((preset) => (
                <CardBoundary key={preset.id} label={preset.meta.name}>
                  <Cell
                    preset={preset}
                    aura={rail}
                    reduced={reduced}
                    primary={many && preset.id === project?.primary}
                    focus={preset.id === focusedId ? focus : null}
                    onSelect={onSelect}
                    onHover={onHover}
                    onPhotoDrop={onPhotoDrop}
                  />
                </CardBoundary>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
