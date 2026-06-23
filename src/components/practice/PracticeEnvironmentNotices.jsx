import SafariAudioCompatibilityNotice from './SafariAudioCompatibilityNotice.jsx'
import {
  isSafariFamilyBrowser,
  isTabletLikeDevice,
} from '../../features/platform/browserPracticeSupport.js'

export default function PracticeEnvironmentNotices() {
  const showSafari = isSafariFamilyBrowser()
  const showTablet = isTabletLikeDevice()

  if (!showSafari && !showTablet) {
    return null
  }

  return (
    <div className="practice-env-notices" aria-label="Browser and device notes">
      {showSafari && <SafariAudioCompatibilityNotice />}
      {showTablet && (
        <p className="practice-env-notices__item" role="note">
          Tablet: use fullscreen (<kbd>F</kbd>) for a larger score.
        </p>
      )}
    </div>
  )
}
