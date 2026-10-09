import LegalPage from './LegalPage.jsx'
import { BETA_LABEL } from '../../features/beta/betaInfo.js'

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      lede={`Corranzo is ${BETA_LABEL.toLowerCase()} software. Please read these terms before using the app.`}
    >
      <section>
        <h2>Public beta</h2>
        <p>
          Corranzo is offered as a public beta. Features may change, break, or be removed
          without notice. By using the app you accept that it is experimental software under
          active development.
        </p>
      </section>

      <section>
        <h2>No guarantees</h2>
        <p>
          We do not guarantee that Corranzo will be available, error-free, or suitable for
          any particular purpose. The service is provided &ldquo;as is&rdquo; during the beta
          period.
        </p>
      </section>

      <section>
        <h2>Your uploads</h2>
        <p>
          You are responsible for the PDF, MIDI, MusicXML, and other files you upload or
          import. Do not upload content you do not have the right to use. Corranzo processes
          files locally in your browser; we do not claim ownership of your materials.
        </p>
      </section>

      <section>
        <h2>Copyright</h2>
        <p>
          Respect copyright and licensing laws when uploading sheet music and related files.
          Only use scores and recordings you are permitted to practice with. Corranzo is a
          practice tool; it does not grant rights to reproduce or distribute copyrighted works.
        </p>
      </section>

      <section>
        <h2>Sound credits</h2>
        <p>
          Corranzo&apos;s instrument playback uses the following third-party sample
          libraries, each under a Creative Commons Attribution 3.0 Unported
          (CC&nbsp;BY&nbsp;3.0) license. We thank their creators; the samples may
          have been trimmed, level-matched, or transcoded for playback, which
          does not change their license.
        </p>
        <ul>
          <li>
            Salamander Grand Piano by Alexander Holm (Yamaha C5 recordings) —
            CC&nbsp;BY&nbsp;3.0.
          </li>
          <li>
            Acoustic and clean electric guitar samples by Nicholaus P. Brosowsky,
            from the tonejs-instruments project — CC&nbsp;BY&nbsp;3.0 (code MIT).
          </li>
        </ul>
      </section>

      <p className="legal-page__updated">Last updated: June 24, 2026</p>
    </LegalPage>
  )
}
