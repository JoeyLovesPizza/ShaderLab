import { Component, type ErrorInfo, type ReactNode } from 'react'

/*
 * Catches whatever a cell throws (a shader that won't compile, a draft the
 * packer can't read) and shows the message in the cell's place, so one bad
 * card never takes the page with it.
 */

interface Props {
  label: string
  children: ReactNode
}

interface State {
  error: string | null
}

export class CardBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[ShaderLab] ${this.props.label} failed to render`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="cell-slot cell-slot--broken" role="alert">
          <strong>{this.props.label}</strong>
          <pre>{this.state.error}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
