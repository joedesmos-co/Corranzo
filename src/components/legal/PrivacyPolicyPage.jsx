import LegalPage from './LegalPage.jsx'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '../../features/legal/legalInfo.js'

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lede="How Corranzo handles data in your browser and through third-party services."
    >
      <section>
        <h3>Overview</h3>
        <p>
          Corranzo is a browser-based sheet music practice app. Your uploaded scores,
          practice preferences, and local stats stay on your device unless you choose to
          share feedback with us by email.
        </p>
      </section>

      <section>
        <h3>Google Analytics</h3>
        <p>
          We use Google Analytics (measurement ID G-PRT6SWTWK1) to understand how visitors
          use Corranzo — for example which pages are viewed and how the app performs in
          the wild. Google may collect information such as your IP address, browser type,
          and pages visited. You can learn more in{' '}
          <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
            Google&apos;s Privacy Policy
          </a>
          .
        </p>
      </section>

      <section>
        <h3>Advertising</h3>
        <p>
          Corranzo may display ads through Google AdSense and other advertising partners
          in the future. Those partners may use cookies or similar technologies to show
          relevant ads and measure ad performance. We have not enabled ad scripts yet; this
          policy describes our planned approach for transparency.
        </p>
      </section>

      <section>
        <h3>Cookies</h3>
        <p>
          Cookies and similar technologies may be used for analytics (Google Analytics) and,
          when advertising is enabled, for ad delivery and measurement. You can control
          cookies through your browser settings. Blocking cookies may affect some site
          features.
        </p>
      </section>

      <section>
        <h3>Contact</h3>
        <p>
          For privacy questions or requests, email us at{' '}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <p className="legal-page__updated">Last updated: June 24, 2026</p>
    </LegalPage>
  )
}
