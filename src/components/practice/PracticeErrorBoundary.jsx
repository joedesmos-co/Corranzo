import { Component } from 'react'

/**
 * Keeps practice-mode render/playback failures from blanking the whole app.
 * Errors are logged; the player can reload practice or switch views.
 */
export default class PracticeErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env?.DEV) {
      console.error('[Practice] Render error:', error, info?.componentStack)
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const message =
        this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
      return (
        <div className="practice-workspace__empty" role="alert">
          <h2>Practice view hit a problem</h2>
          <p className="practice-workspace__empty-lead">
            Something went wrong while updating practice. Your piece is still loaded — try
            switching views or reloading the page.
          </p>
          {import.meta.env?.DEV && message ? (
            <p className="practice-workspace__empty-lead">{message}</p>
          ) : null}
          <button
            type="button"
            className="practice-view-switch__option"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
