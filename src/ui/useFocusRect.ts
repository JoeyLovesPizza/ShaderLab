import { useSyncExternalStore } from 'react'
import { CARD } from '../states/machine'

/*
 * Where the focused card sits: the viewport less a 48px margin and the
 * header, with the card fitted into what is left at its own ratio and
 * centred there (SPEC.md §6, Focus). The DialKit panel's column on the
 * right is kept clear only when the window has room for both; in a narrow
 * pane the card takes the width and the panel overlaps it, which beats an
 * "expanded" card the size of a thumbnail. Computed in px rather than CSS
 * so Motion can measure the target box.
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export const HEADER_HEIGHT = 64
const MARGIN = 48
/** Room kept clear on the right for the DialKit popover, when it fits. */
const PANEL_COLUMN = 340
/** The least width the card gets before the panel is allowed to overlap it. */
const MIN_CARD_WIDTH = 560

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

// Serialised so useSyncExternalStore can compare snapshots by value.
function snapshot() {
  return `${window.innerWidth}x${window.innerHeight}`
}

export function useFocusRect(): Rect {
  const size = useSyncExternalStore(subscribe, snapshot)
  const [w, h] = size.split('x').map(Number)
  const withPanel = w - 2 * MARGIN - PANEL_COLUMN
  const availWidth = Math.max(200, withPanel >= MIN_CARD_WIDTH ? withPanel : w - 2 * MARGIN)
  const availHeight = Math.max(140, h - HEADER_HEIGHT - 2 * MARGIN)
  const scale = Math.min(availWidth / CARD.width, availHeight / CARD.height)
  const width = Math.round(CARD.width * scale)
  const height = Math.round(CARD.height * scale)
  return {
    left: Math.round(MARGIN + (availWidth - width) / 2),
    top: Math.round(HEADER_HEIGHT + MARGIN + (availHeight - height) / 2),
    width,
    height,
  }
}
