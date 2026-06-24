import LegalPage from './LegalPage.jsx'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '../../features/legal/legalInfo.js'
import { FEEDBACK_MAILTO, FEEDBACK_EMAIL } from '../../features/beta/betaInfo.js'

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact"
      lede="Questions about Corranzo, privacy, or the public beta."
    >
      <section>
        <h3>Email</h3>
        <p>
          Reach us at{' '}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h3>Product feedback</h3>
        <p>
          For bug reports and beta feedback, you can also use our{' '}
          <a href={FEEDBACK_MAILTO}>feedback template</a> ({FEEDBACK_EMAIL}).
        </p>
      </section>

      <p className="legal-page__updated">We aim to respond when we can during the beta.</p>
    </LegalPage>
  )
}
