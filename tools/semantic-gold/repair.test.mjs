import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWrittenNotation, buildTupletLabels } from './assembler.mjs'
import { repairContext, repairScope } from './repair-scope.mjs'
import { matchSourceRestsToTruth } from './rest-alignment.mjs'

const tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
const mark = (type, number = 1, ratio = '') => `<tuplet type="${type}" number="${number}">${ratio}</tuplet>`
const note = (marks = '', { ordinary = false, rest = false } = {}) => `<note>${rest ? '<rest/>' : '<pitch><step>C</step><octave>4</octave></pitch>'}<duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff>${ordinary ? '' : tm}<notations>${marks}</notations></note>`
const xml = notes => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>6</divisions></attributes>${notes}</measure></part></score-partwise>`
function tuplets(notes, unmapped = []) {
  const truth = parseWrittenNotation(xml(notes))
  const eventRef = new Map(truth.notes.filter((n, i) => !unmapped.includes(i)).map((n, i) => [n.id, { objectIndex: i, matchState: 'KNOWN', confidence: 1 }]))
  return buildTupletLabels({ truth, eventRef, scope: { state: 'KNOWN' }, scopeId: 'fixture' })
}

test('adjacent same-ratio tuplets respect written unequal-member spans and stop/new start', () => {
  const rows = tuplets(note(mark('start')) + note(mark('stop')) + note(mark('start')) + note(mark('stop')))
  assert.deepEqual(rows.map(r => [r.state, r.objectIndexes]), [['KNOWN', [0, 1]], ['KNOWN', [2, 3]]])
})

test('ordinary notes separate tuplets; ratio-only runs are unavailable', () => {
  const rows = tuplets(note(mark('start')) + note(mark('stop')) + note('', { ordinary: true }) + note() + note() + note())
  assert.equal(rows[0].state, 'KNOWN')
  assert.deepEqual(rows[0].objectIndexes, [0, 1])
  assert.equal(rows[1].state, 'UNAVAILABLE')
  assert.deepEqual(rows[1].objectIndexes, [3, 4, 5])
})

test('nested numbered boundaries preserve both levels with explicit level ratios', () => {
  const ratio = '<tuplet-actual><tuplet-number>3</tuplet-number></tuplet-actual><tuplet-normal><tuplet-number>2</tuplet-number></tuplet-normal>'
  const rows = tuplets(note(mark('start', 1, ratio)) + note(mark('start', 2, ratio)) + note(mark('stop', 2)) + note(mark('stop', 1)))
  assert.deepEqual(rows.map(r => [r.state, r.objectIndexes]), [['KNOWN', [1, 2]], ['KNOWN', [0, 1, 2, 3]]])
  const uncertain = tuplets(note(mark('start', 1)) + note(mark('start', 2)) + note(mark('stop', 2)) + note(mark('stop', 1)))
  assert.ok(uncertain.every(row => row.state === 'UNAVAILABLE'))
  const crossing = tuplets(note(mark('start', 1, ratio)) + note(mark('start', 2, ratio)) + note(mark('stop', 1)) + note(mark('stop', 2)))
  assert.ok(crossing.every(row => row.state === 'UNAVAILABLE'))
})

test('incomplete and repeated explicit boundaries abstain conservatively', () => {
  for (const notation of [note(mark('start')) + note() + note(), note(mark('stop')), note(mark('start')) + note(mark('start'))]) {
    assert.ok(tuplets(notation).every(r => r.state === 'UNAVAILABLE'))
  }
  const rows = tuplets(note(mark('start')) + note('', { ordinary: true }) + note(mark('stop')))
  assert.ok(rows.every(r => r.state === 'UNAVAILABLE'))
})

test('tuplet rests are members and missing source attachments abstain', () => {
  const notation = note(mark('start')) + note('', { rest: true }) + note(mark('stop'))
  assert.deepEqual(tuplets(notation)[0].objectIndexes, [0, 1, 2])
  assert.equal(tuplets(notation, [1])[0].state, 'UNAVAILABLE')
})

function restFixture() {
  const source = { metadata: { exampleId: 'scope', scopeId: 'scope', groupId: 'fixture', page: 1,
    semanticMeasureNumber: 1, eligibleScopeState: 'KNOWN', sourceObjectIds: [] }, modelInput: {
    physicalObjects: [], availabilityMasks: { printedRests: false }, geometry: {
      pageTransform: { sourceWidth: 1000, sourceHeight: 1000 }, scopeBounds: { x0: .1, x1: .9, y0: .1, y1: .9 } },
    sourceGraph: { state: 'AVAILABLE_INDEPENDENT_PDF_SOURCE_EVIDENCE', sourceScope: { page: 1, systemIndex: 0, measureNumber: 999 },
      sourceGeometry: { staffSpacePx: 10 }, independence: Object.fromEntries(['readsFinalEvents', 'readsMusicXml', 'readsReconstructedOnsets', 'readsTopologyFamily', 'readsTruthOrEvaluator', 'readsVoices'].map(k => [k, false])),
      nodes: [{ id: 'rest-source', kind: 'rest', source: 'vector-glyph', glyphClass: 'eighth', staffRole: 'upper', anchor: { x: 400, y: 300 } }], edges: [] } } }
  const target = { metadata: { exampleId: 'scope' }, families: { PITCH_STAFF: [], REST: [], TUPLET: [], DURATION: [{ sentinel: 'unchanged' }] } }
  return { source, target }
}

test('rest repair uses frozen coordinates, ignores nominal graph measure, and preserves other families', () => {
  const { source, target } = restFixture()
  const before = structuredClone(source)
  const context = repairContext(xml(note('', { ordinary: true, rest: true })), [source])
  const result = repairScope(context, source, target)
  assert.equal(result.target.families.REST[0].state, 'KNOWN')
  assert.deepEqual(result.target.families.REST[0].objectIndexes, [0])
  assert.deepEqual(result.source.modelInput.physicalObjects[0].center, { x: .4, y: .3, coordinateSpace: 'pdf-source-normalized' })
  assert.deepEqual(source, before)
  assert.deepEqual(result.target.families.DURATION, target.families.DURATION)
})

test('untrusted rest graphs reject; mismatches and simultaneous voices abstain without negative labels', () => {
  const { source, target } = restFixture()
  let context = repairContext(xml(note('', { ordinary: true })), [source])
  const result = repairScope(context, source, target)
  assert.equal(result.target.families.REST[0].state, 'UNAVAILABLE')
  assert.equal(result.target.families.REST[0].isPositive, true)
  source.modelInput.sourceGraph.independence.readsMusicXml = true
  assert.throws(() => repairScope(context, source, target), /not truth-independent/)
  const rests = [0, 1].map(i => ({ sourceRestId: String(i), state: 'KNOWN', staffRole: 'upper', sourceGlyphClass: 'eighth', center: { x: .2 + i * .2, y: .3 } }))
  const truth = [0, 1].map(i => ({ id: String(i), staff: 1, noteType: 'eighth', offsetQuarters: 0 }))
  assert.equal(matchSourceRestsToTruth(rests, truth).mapping.size, 0)
})

test('overlapping source scopes cannot produce a trusted rest attachment', () => {
  const { source, target } = restFixture()
  const other = structuredClone(source)
  other.metadata.scopeId = 'overlapping-source-scope'
  const context = repairContext(xml(note('', { rest: true, ordinary: true })), [source, other])
  const result = repairScope(context, source, target)
  assert.equal(result.source.modelInput.physicalObjects.length, 0)
  assert.equal(result.target.families.REST[0].state, 'UNAVAILABLE')
})
