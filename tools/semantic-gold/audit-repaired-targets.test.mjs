import assert from 'node:assert/strict'
import test from 'node:test'
import { auditWrittenTargets } from './audit-repaired-targets.mjs'

const note = mark => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="${mark}" number="1"/></notations></note>`
const xml = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>6</divisions></attributes>${['start','stop','start','stop'].map(note).join('')}</measure></part></score-partwise>`
const label = indexes => ({ labelId:'generic-span',semanticEventIds:indexes.map(i=>`P1-m1-n${i}`),value:{boundaryNumber:'1',memberEventCount:indexes.length,ratio:{actualNotes:3,normalNotes:2},sourceMark:{marks:[]}} })

test('independent auditor checks raw written boundaries even when emitted marks conceal the contradiction',()=>{
  assert.deepEqual(auditWrittenTargets(xml,[{tuplets:[label([1,2]),label([3,4])],rests:[]}]).errors,[])
  const bad=auditWrittenTargets(xml,[{tuplets:[label([1,2,3])],rests:[]}])
  assert.ok(bad.errors.some(e=>e.reason==='CONTRADICTORY_EXPLICIT_BOUNDARIES'))
})

test('independent auditor rejects missing members and wrong rest duration/staff',()=>{
  const missing=auditWrittenTargets(xml,[{tuplets:[label([1,4])],rests:[]}])
  assert.ok(missing.errors.some(e=>e.reason==='MISSING_OR_EXTRANEOUS_SPAN_MEMBERS'))
  const restXml='<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><rest/><duration>4</duration><type>quarter</type><staff>1</staff></note></measure></part></score-partwise>'
  const rest={label:{labelId:'rest',semanticEventIds:['P1-m1-n1'],value:{writtenType:'quarter',dots:0,divisionsNormalizedQuarters:1}},glyphClass:'quarter',staffRole:'upper'}
  assert.deepEqual(auditWrittenTargets(restXml,[{tuplets:[],rests:[rest]}]).errors,[])
  rest.label.value.divisionsNormalizedQuarters=.5;rest.staffRole='lower'
  assert.equal(auditWrittenTargets(restXml,[{tuplets:[],rests:[rest]}]).errors.length,2)
})

test('independent rest audit accepts equivalent fraction spellings and rejects different types', () => {
  const restXml='<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><rest/><duration>1</duration><type>16th</type><staff>1</staff></note></measure></part></score-partwise>'
  const rest={label:{labelId:'rest',semanticEventIds:['P1-m1-n1'],value:{writtenType:'16th',dots:0,divisionsNormalizedQuarters:.25}},glyphClass:'sixteenth',staffRole:'upper'}
  assert.deepEqual(auditWrittenTargets(restXml,[{tuplets:[],rests:[rest]}]).errors,[])
  rest.glyphClass='thirtySecond'
  assert.ok(auditWrittenTargets(restXml,[{tuplets:[],rests:[rest]}]).errors.some(e=>e.reason==='SOURCE_GLYPH_OR_STAFF_MISMATCH'))
})
