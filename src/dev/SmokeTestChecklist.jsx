const CHECKLIST_ITEMS = [
  'PDF renders; page nav, zoom/fit, annotations save after reload',
  'Fullscreen PDF + HUD; Space, arrows, Shift+arrows, F, Esc',
  'MIDI playback; transport; measure/beat nav; loop region',
  'MusicXML timing; position display; shared clock with MIDI',
  'Wait For You beat + note modes; Web MIDI (if available)',
  'Score-follow anchors + cursor; Library ↔ Practice tabs',
]

export default function SmokeTestChecklist() {
  return (
    <section className="practice-section practice-section--dev" aria-label="Smoke test checklist">
      <h3 className="practice-section__title practice-section__title--static practice-section__title--editorial">
        Smoke test checklist
      </h3>
      <p className="practice-section__hint">
        After loading samples, walk through these flows manually. Development only.
      </p>
      <ul className="smoke-test-checklist">
        {CHECKLIST_ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
