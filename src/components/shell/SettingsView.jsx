import InstrumentSelector from '../InstrumentSelector.jsx'
import FeedbackLink from '../FeedbackLink.jsx'
import SegmentedControl from '../../design/SegmentedControl.jsx'
import { Toggle } from '../../design/Fields.jsx'
import { Button } from '../../design/Button.jsx'
import { Divider, Panel } from '../../design/Feedback.jsx'
import { BETA_LABEL, LOCAL_ONLY_MESSAGE } from '../../features/beta/betaInfo.js'

/**
 * Settings (Phase B shell page). Modest by design: it surfaces preferences
 * that already exist across the app in one quiet place. No new behavior is
 * invented here; deeper settings arrive with their product phases.
 */
export default function SettingsView({
  paperTheme,
  onPaperThemeChange,
  sidebarExpanded,
  onSidebarExpandedChange,
  onClearSavedSession,
  onNavigate,
}) {
  return (
    <main className="cz-settings" aria-labelledby="cz-settings-heading">
      <div className="cz-settings__inner">
        <p className="cz-kicker">Corranzo · {BETA_LABEL}</p>
        <h1 id="cz-settings-heading" className="cz-settings__title">
          Settings
        </h1>

        <Panel title="Appearance" headingLevel={2} sub="How the workspace looks on this device.">
          <div className="cz-settings__rows">
            <div className="cz-settings__row">
              <div>
                <p className="cz-settings__label">Score paper</p>
                <p className="cz-settings__hint">Notation always renders on paper, never inverted.</p>
              </div>
              <SegmentedControl
                label="Score paper"
                value={paperTheme === 'light' ? 'light' : 'dark'}
                onChange={onPaperThemeChange}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            </div>
            <Divider />
            <div className="cz-settings__row">
              <div>
                <p className="cz-settings__label">Sidebar</p>
                <p className="cz-settings__hint">Wide screens remember this choice.</p>
              </div>
              <Toggle
                label={sidebarExpanded ? 'Expanded' : 'Rail'}
                checked={sidebarExpanded}
                onChange={onSidebarExpandedChange}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Instrument" headingLevel={2} sub="Switching returns to Library — live sessions never carry over silently.">
          <InstrumentSelector />
        </Panel>

        <Panel title="Practice history" headingLevel={2} sub="Time is tracked automatically while a piece is open; manual sessions can be logged too.">
          <Button onClick={() => onNavigate('profile')}>Open practice history</Button>
        </Panel>

        <Panel title="Files & storage" headingLevel={2} sub={LOCAL_ONLY_MESSAGE}>
          <Button variant="danger" onClick={onClearSavedSession}>
            Clear saved session
          </Button>
        </Panel>

        <Panel title="About" headingLevel={2} sub="Corranzo is local-first. There is no account and nothing uploads.">
          <div className="cz-settings__actions">
            <FeedbackLink label="Email feedback" />
            <span className="cz-settings__legal">
              <Button variant="ghost" size="sm" onClick={() => onNavigate('privacy')}>
                Privacy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('terms')}>
                Terms
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigate('contact')}>
                Contact
              </Button>
            </span>
          </div>
        </Panel>
      </div>
    </main>
  )
}
