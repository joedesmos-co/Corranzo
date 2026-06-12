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
      <h1 className="topbar__title">ScoreFlow</h1>
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
    </header>
  )
}
