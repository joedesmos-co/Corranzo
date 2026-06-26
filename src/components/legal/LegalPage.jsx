import CorranzoLogo from '../CorranzoLogo.jsx'

export default function LegalPage({ title, lede, children }) {
  return (
    <main className="legal-page" aria-labelledby="legal-heading">
      <header className="legal-page__header">
        <CorranzoLogo className="legal-page__logo" width={180} height={52} />
        <h2 id="legal-heading" className="legal-page__title">
          {title}
        </h2>
        {lede ? <p className="legal-page__lede">{lede}</p> : null}
      </header>
      <article className="legal-page__content">{children}</article>
    </main>
  )
}
