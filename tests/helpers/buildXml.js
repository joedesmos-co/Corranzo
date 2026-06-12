/**
 * Deterministic MusicXML fixture builders for regression tests.
 * Raw string templates so document order is exactly what each test declares.
 */

export function scoreWrap(partsXml, partList = null) {
  const list =
    partList ??
    `<part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  ${list}
  ${partsXml}
</score-partwise>`
}

export function attributes({ divisions = 1, beats = 4, beatType = 4, includeTime = true } = {}) {
  return (
    `<attributes><divisions>${divisions}</divisions>` +
    (includeTime ? `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` : '') +
    `<clef><sign>G</sign><line>2</line></clef></attributes>`
  )
}

export function note(step = 'C', octave = 4, duration = 1, extra = '') {
  return `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>quarter</type>${extra.replace('<chord/>', '')}</note>`
}

export function rest(duration = 1) {
  return `<note><rest/><duration>${duration}</duration><voice>1</voice></note>`
}

export function soundTempo(bpm) {
  return `<direction><sound tempo="${bpm}"/></direction>`
}

export function metronomeDirection(beatUnit, perMinute, { dot = false } = {}) {
  return `<direction><direction-type><metronome><beat-unit>${beatUnit}</beat-unit>${dot ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute></metronome></direction-type></direction>`
}

export function fourQuarters(steps = ['C', 'D', 'E', 'F']) {
  return steps.map((s) => note(s)).join('')
}

const forwardRepeat = `<barline location="left"><repeat direction="forward"/></barline>`
const backwardRepeat = (times = null) =>
  `<barline location="right"><repeat direction="backward"${times ? ` times="${times}"` : ''}/></barline>`
const endingStart = (numbers) => `<barline location="left"><ending number="${numbers}" type="start"/></barline>`
const endingStop = (numbers) => `<ending number="${numbers}" type="stop"/>`

/** 4 measures, 4/4 @120, no repeats. */
export function straight4() {
  let xml = ''
  for (let m = 1; m <= 4; m += 1) {
    xml += `<measure number="${m}">`
    if (m === 1) xml += attributes() + soundTempo(120)
    xml += fourQuarters()
    xml += `</measure>`
  }
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** m1(fwd) m2(bwd) m3 m4 → performed 1,2,1,2,3,4 */
export function oneRepeat() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>` +
    `<measure number="4">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Two independent repeated sections → performed 1,2,1,2,3,4,3,4 */
export function twoRepeatSections() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="4">${fourQuarters()}${backwardRepeat()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Backward repeat with no forward repeat → repeat from beginning: 1,2,1,2,3 */
export function repeatToBeginning() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** times="3" on the backward repeat → 1,2,1,2,1,2,3 */
export function repeatTimes3() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}${backwardRepeat(3)}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Single-measure voltas: m2=volta1(bwd), m3=volta2 → 1,2,1,3,4 */
export function singleMeasureVoltas() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${endingStart(1)}${fourQuarters()}<barline location="right">${endingStop(1)}<repeat direction="backward"/></barline></measure>` +
    `<measure number="3">${endingStart(2)}${fourQuarters()}<barline location="right">${endingStop(2)}</barline></measure>` +
    `<measure number="4">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Multi-measure volta 1 = m2–m3; volta 2 = m4–m5 → 1,2,3,1,4,5 */
export function multiMeasureVoltas() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${endingStart(1)}${fourQuarters()}</measure>` +
    `<measure number="3">${fourQuarters()}<barline location="right">${endingStop(1)}<repeat direction="backward"/></barline></measure>` +
    `<measure number="4">${endingStart(2)}${fourQuarters()}</measure>` +
    `<measure number="5">${fourQuarters()}<barline location="right">${endingStop(2)}</barline></measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Two repeated sections where the SECOND has voltas — regression for global-pass bug. */
export function secondSectionVoltas() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="4">${endingStart(1)}${fourQuarters()}<barline location="right">${endingStop(1)}<repeat direction="backward"/></barline></measure>` +
    `<measure number="5">${endingStart(2)}${fourQuarters()}<barline location="right">${endingStop(2)}</barline></measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Malformed: backward repeat before any content + forward repeat never closed. Must terminate. */
export function malformedRepeats() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="2">${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="3">${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="4">${forwardRepeat}${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Tempo change at the start of m2 (direction before notes). */
export function measureStartTempoChange() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${fourQuarters()}</measure>` +
    `<measure number="2">${soundTempo(60)}${fourQuarters()}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Tempo change after beat 2 of m2 — depends on document-order parsing. */
export function midMeasureTempoChange() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${fourQuarters()}</measure>` +
    `<measure number="2">${note('C')}${note('D')}${soundTempo(60)}${note('E')}${note('F')}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Metronome mark half = 60 → effective 120 quarter-BPM. */
export function beatUnitMetronome() {
  const xml =
    `<measure number="1">${attributes()}${metronomeDirection('half', 60)}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Dotted-quarter = 40 in 6/8 → effective 60 quarter-BPM. */
export function dottedBeatUnitMetronome() {
  const xml =
    `<measure number="1">${attributes({ divisions: 2, beats: 6, beatType: 8 })}${metronomeDirection('quarter', 40, { dot: true })}` +
    `${note('C', 4, 1)}${note('D', 4, 1)}${note('E', 4, 1)}${note('F', 4, 1)}${note('G', 4, 1)}${note('A', 4, 1)}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Two parts with different divisions describing the same rhythm. */
export function twoPartsDifferentDivisions() {
  const p1 =
    `<measure number="1">${attributes({ divisions: 2 })}${soundTempo(120)}` +
    `${note('C', 4, 2)}${note('D', 4, 2)}${note('E', 4, 2)}${note('F', 4, 2)}</measure>`
  const p2 =
    `<measure number="1">${attributes({ divisions: 8 })}` +
    `${note('C', 3, 8)}${note('D', 3, 8)}${note('E', 3, 8)}${note('F', 3, 8)}</measure>`
  const list = `<part-list><score-part id="P1"><part-name>RH</part-name></score-part><score-part id="P2"><part-name>LH</part-name></score-part></part-list>`
  return scoreWrap(`<part id="P1">${p1}</part><part id="P2">${p2}</part>`, list)
}

/** Two voices via backup, plus forward-offset voice — document-order dependent. */
export function backupForwardVoices() {
  const m1 =
    `<measure number="1">${attributes({ divisions: 2 })}${soundTempo(120)}` +
    // voice 1: four quarters at 0,1,2,3
    `${note('C', 5, 2)}${note('D', 5, 2)}${note('E', 5, 2)}${note('F', 5, 2)}` +
    `<backup><duration>8</duration></backup>` +
    // voice 2: two halves at 0,2
    `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note>` +
    `<note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note>` +
    `<backup><duration>8</duration></backup>` +
    `<forward><duration>4</duration></forward>` +
    // voice 3: half note at quarter 2
    `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>3</voice></note>` +
    `</measure>`
  return scoreWrap(`<part id="P1">${m1}</part>`)
}

/** 6 measures, new-system before m3 and m5, new-page before m5. */
export function systemsAndPages() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${fourQuarters()}</measure>` +
    `<measure number="2">${fourQuarters()}</measure>` +
    `<measure number="3"><print new-system="yes"/>${fourQuarters()}</measure>` +
    `<measure number="4">${fourQuarters()}</measure>` +
    `<measure number="5"><print new-page="yes"/>${fourQuarters()}</measure>` +
    `<measure number="6">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Chord (C+E+G) on beat 1, then three quarters. */
export function chordFixture() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}` +
    `${note('C')}` +
    `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>` +
    `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>` +
    `${note('D')}${note('E')}${note('F')}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Repeat fixture: tempo drops in m2, explicit 120 BPM restore in m3 after the repeat. */
export function repeatWithTempoChange() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${soundTempo(60)}${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${soundTempo(120)}${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Same repeat layout but m3 has no tempo restoration — 60 BPM persists (MusicXML semantics). */
export function repeatWithTempoChangeNoRestore() {
  const xml =
    `<measure number="1">${attributes()}${soundTempo(120)}${forwardRepeat}${fourQuarters()}</measure>` +
    `<measure number="2">${soundTempo(60)}${fourQuarters()}${backwardRepeat()}</measure>` +
    `<measure number="3">${fourQuarters()}</measure>`
  return scoreWrap(`<part id="P1">${xml}</part>`)
}

/** Notes with default-x layout for anchor-promotion tests (two systems of 2 measures). */
export function layoutRichTwoSystems() {
  const noteX = (step, x) =>
    `<note default-x="${x}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>`
  const measure = (n, breakBefore = false) =>
    `<measure number="${n}">${breakBefore ? '<print new-system="yes"/>' : ''}${n === 1 ? attributes() + soundTempo(120) : ''}` +
    `${noteX('C', 10)}${noteX('D', 40)}${noteX('E', 70)}${noteX('F', 100)}</measure>`
  const xml = measure(1) + measure(2) + measure(3, true) + measure(4)
  return scoreWrap(`<part id="P1">${xml}</part>`)
}
