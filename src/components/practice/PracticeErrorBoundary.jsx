import { Component } from 'react'

/**
 * Keeps practice-mode render/playback failures from blanking the whole app.
 * Errors are logged; the player can reload practice or return to Library.
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

  handleReload = () => {
    if (this.props.onReloadPractice) {
      this.setState({ error: null })
      this.props.onReloadPractice()
      return
    }
    globalThis.location?.reload?.()
  }

  handleReturnToLibrary = () => {
    if (this.props.onReturnToLibrary) {
      this.setState({ error: null })
      this.props.onReturnToLibrary()
      return
    }
    globalThis.location?.assign?.('/')
  }

  render() {
    if (this.state.error) {
      const message =
        this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
      return (
        <div className="practice-workspace__empty" role="alert">
          <h2>Practice view hit an error</h2>
          <p className="practice-workspace__empty-lead">
            Something went wrong while updating practice. Reload this piece or return to Library to
            keep going.
          </p>
          {import.meta.env?.DEV && message ? (
            <p className="practice-workspace__empty-lead">{message}</p>
          ) : null}
          <div className="practice-view-switch" role="group" aria-label="Practice error recovery">
            <button
              type="button"
              className="practice-view-switch__option"
              onClick={this.handleReload}
            >
              Reload this piece
            </button>
            <button
              type="button"
              className="practice-view-switch__option"
              onClick={this.handleReturnToLibrary}
            >
              Return to Library
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
