import {
  BETA_LABEL,
  BETA_VERSION,
} from '../features/beta/betaInfo.js'
import FeedbackLink from './FeedbackLink.jsx'

const VIEWS = [
  { id: 'library', label: 'Library' },
  { id: 'practice', label: 'Practice' },
  { id: 'profile', label: 'Profile' },
]

export default function TopBar({ activeView, onNavigate, practiceReady = true }) {
  function handleNavigate(id) {
    if (id === 'practice' && !practiceReady) {
      onNavigate(id, { blocked: true })
      return
    }
    onNavigate(id)
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <h1 className="topbar__title">Corranzo</h1>
        <span className="topbar__beta">
          {BETA_LABEL} <span aria-hidden="true">·</span> v{BETA_VERSION}
        </span>
      </div>
      <div className="topbar__actions">
        <nav className="topbar__nav" aria-label="Main">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`topbar__nav-btn${activeView === id ? ' topbar__nav-btn--active' : ''}${
                id === 'practice' && !practiceReady ? ' topbar__nav-btn--muted' : ''
              }`}
              onClick={() => handleNavigate(id)}
              aria-current={activeView === id ? 'page' : undefined}
              title={
                id === 'practice' && !practiceReady
                  ? 'Upload a PDF and score timing file in Library first'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <FeedbackLink className="topbar__feedback" label="Feedback" />
      </div>
    </header>
  )
}
