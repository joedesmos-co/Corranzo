import { isProfileDevToolsEnabled } from '../../features/profile/profileDevAccess.js'
import { useProfileStats } from '../../context/ProfileStatsContext.jsx'

export default function ProfileDevTools() {
  const { seedDemoStats, resetAllStats } = useProfileStats()

  if (!isProfileDevToolsEnabled()) {
    return null
  }

  return (
    <div className="profile-dev-tools" aria-label="Developer profile tools">
      <p className="profile-dev-tools__label">Screenshot helpers</p>
      <div className="profile-dev-tools__actions">
        <button type="button" className="profile-dev-tools__btn" onClick={seedDemoStats}>
          Seed demo stats
        </button>
        <button
          type="button"
          className="profile-dev-tools__btn profile-dev-tools__btn--muted"
          onClick={() => {
            if (window.confirm('Clear seeded demo stats and reset profile?')) {
              resetAllStats()
            }
          }}
        >
          Clear demo stats
        </button>
      </div>
    </div>
  )
}
