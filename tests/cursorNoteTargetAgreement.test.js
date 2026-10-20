import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { resolveNoteTargetPosition } from '../src/features/practice/noteTargetPosition.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'

/**
 * The painted red cursor and the note target MUST resolve the same note to
 * the same x. They used to use two different default-x mappings (the cursor
 * subtracted the first onset's default-x and extrapolated the barline), so
 * the line could sit tens of pixels away from the notehead it was meant to
 * trigger. This asserts the shared invariant directly.
 */
describe('cursor and note target share one geometry', () => {
  const anchors = [
    {
      id: 'm1',
      page: 1,
      x: 0.1,
      y: 0.3,
      measureNumber: 1,
      source: 'manual',
      meta: { role: 'measure', playableStartX: 0.1, playableEndX: 0.2, systemEndX: 0.95 },
    },
  ]

  const timingMap = parseMusicXml(
    `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
      `<part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>` +
      `<clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<note default-x="10"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>` +
      `<note default-x="30"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>` +
      `<note default-x="50"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>` +
      `<note default-x="70"><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>` +
      `</measure></part></score-partwise>`,
    'x.musicxml',
  )

  it('places the cursor exactly on the notehead the note target paints', () => {
    const checkpoints = buildNoteCheckpoints(timingMap, null, {})
    const timeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: anchors })
    expect(checkpoints.length).toBeGreaterThan(0)

    for (const checkpoint of checkpoints) {
      const target = resolveNoteTargetPosition({
        checkpoint,
        timingMap,
        anchors,
        mode: 'play-along',
      })
      if (!target.visible) continue
      const cursor = resolveCursorMotion(timeline, checkpoint.timeSeconds)
      expect(cursor, `cursor at ${checkpoint.timeSeconds}s`).toBeTruthy()
      // The line and the box it triggers must be the same column.
      expect(Math.abs(cursor.x - target.x)).toBeLessThan(1e-6)
    }
  })

  it('the cursor starts at the first note, not at a page- or time-zero offset', () => {
    const timeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: anchors })
    const atZero = resolveCursorMotion(timeline, 0)
    expect(atZero.measureNumber).toBe(1)
    // The first note is engraved at default-x 10 of a 110-tenth measure
    // (max default-x 70 + 40 of trailing space), mapped across the measure's
    // playable span [0.1, 0.2] → 0.10909. It must sit ON the notehead column:
    // not at the bare measure start (0.1) and not at the page origin (0).
    expect(atZero.x).toBeCloseTo(0.10909, 5)
    expect(atZero.x).toBeGreaterThan(0.1)
  })
})
