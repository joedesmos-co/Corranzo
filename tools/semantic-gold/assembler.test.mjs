import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import {
  buildGlobalRelations,
  canonicalLaneCatalog,
  findFirewallViolations,
  matchAnchorsToPhysical,
  measureTruth,
  musicalFingerprints,
  parseWrittenNotation,
  targetRecordFor,
  verifySourceIdentity,
} from './assembler.mjs'
import { matchSourceRestsToTruth } from './rest-alignment.mjs'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

function scoreXml(measures, title = 'Fixture') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`
}

const attributes = `
  <attributes>
    <divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>
    <staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>`

function pitched({ step, octave, duration = 4, voice = 1, staff = 1, chord = false, extra = '', x = null }) {
  return `<note${x == null ? '' : ` default-x="${x}"`}>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>${duration == null ? '' : `<duration>${duration}</duration>`}<voice>${voice}</voice><type>${duration === 2 ? 'eighth' : 'quarter'}</type><staff>${staff}</staff>${extra}</note>`
}

function anchor(id, midi, x, staffIndex = 0) {
  return {
    sourceNoteheadId: id,
    page: 1,
    measureNumber: 1,
    kind: 'notehead',
    midi,
    staffIndex,
    sourceCenter: { x, y: staffIndex ? 0.7 : 0.3, coordinateSpace: 'pdf-source-normalized' },
    sourceBBox: { x0: x - 0.01, x1: x + 0.01, y0: staffIndex ? 0.69 : 0.29, y1: staffIndex ? 0.71 : 0.31, coordinateSpace: 'pdf-source-normalized' },
    staffGap: 0.01,
    confidence: 1,
    geometrySource: 'fixture',
  }
}

function scope(measureNumber, anchors, state = 'KNOWN') {
  return {
    scopeId: `fixture:semantic-m${measureNumber}`,
    pairId: { id: 'fixture', pdfSha256: 'p', truthSha256: 't' },
    groupId: 'fixture',
    semanticMeasureNumber: measureNumber,
    page: 1,
    systemIndex: 0,
    sourceBounds: { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9, coordinateSpace: 'pdf-source-normalized' },
    pageTransform: { sourceWidth: 1000, sourceHeight: 1000, renderedWidth: 1000, renderedHeight: 1000 },
    staffBounds: {
      y0: 0.1,
      y1: 0.9,
      staffBands: [
        { staffRole: 'upper', y0: 0.2, y1: 0.4 },
        { staffRole: 'lower', y0: 0.6, y1: 0.8 },
      ],
    },
    barlineEvidence: [],
    sourceObjectIds: anchors.map((entry) => entry.sourceNoteheadId),
    confidence: state === 'KNOWN' ? 1 : 0.5,
    state,
    strict52: false,
  }
}

function assemble(xml, anchorsByMeasure) {
  const notation = parseWrittenNotation(xml, 'fixture.musicxml')
  const laneCatalog = canonicalLaneCatalog(notation)
  const scopes = new Map()
  const truths = new Map()
  const mappings = new Map()
  const eventRefsByScope = new Map()
  for (const [measureNumber, anchors] of anchorsByMeasure) {
    const currentScope = scope(measureNumber, anchors)
    const truth = measureTruth(notation, measureNumber)
    const mapping = matchAnchorsToPhysical(anchors, truth.physicalGroups)
    const objectIndexById = new Map(currentScope.sourceObjectIds.map((id, index) => [id, index]))
    const eventRefs = new Map()
    truth.physicalGroups.forEach((physical) => {
      const match = mapping.mapping.get(physical.key)
      const ref = match ? {
        objectIndex: objectIndexById.get(match.anchorId),
        matchState: match.state,
        confidence: match.confidence,
        method: match.method,
      } : null
      physical.roles.forEach((role) => eventRefs.set(role.id, ref))
    })
    scopes.set(measureNumber, currentScope)
    truths.set(measureNumber, truth)
    mappings.set(measureNumber, mapping)
    eventRefsByScope.set(currentScope.scopeId, eventRefs)
  }
  const globalRelations = buildGlobalRelations({ notation, scopeByMeasure: scopes, eventRefsByScope, laneCatalog })
  const targets = new Map()
  for (const [measureNumber, currentScope] of scopes) {
    targets.set(measureNumber, targetRecordFor({
      scope: currentScope,
      truth: truths.get(measureNumber),
      mapping: mappings.get(measureNumber),
      anchors: anchorsByMeasure.get(measureNumber),
      laneCatalog,
      manifestRecord: { split: 'train' },
      globalRelations,
    }))
  }
  return { notation, targets, mappings }
}

test('source-coordinate identity reproduces 52/52 scopes and 895/895 heads', () => {
  const source = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/campaign/piano-vision-phase212s/source-scope-map.json'), 'utf8'))
  const strict = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/campaign/piano-vision-phase212s/corrected-strict52.json'), 'utf8'))
  assert.deepEqual(verifySourceIdentity(source, strict), {
    scopes: 52,
    knownScopes: 52,
    sourceVisibleHeads: 895,
    coordinateMatchedHeads: 895,
    unmatchedHeads: 0,
    nominalMeasureLabelsUsedForMatching: false,
    pass: true,
  })
})

test('alignment does not depend on nominal graph measure identity', () => {
  const anchors = [anchor('a', 60, 0.2)]
  const physical = [{ key: 'p', representative: { midi: 60, staff: 1, offsetQuarters: 0, durationQuarters: 1 }, roles: [] }]
  const first = matchAnchorsToPhysical(anchors.map((value) => ({ ...value, nominalGraphMeasure: 1 })), physical)
  const second = matchAnchorsToPhysical(anchors.map((value) => ({ ...value, nominalGraphMeasure: 999 })), physical)
  assert.deepEqual([...first.mapping], [...second.mapping])
})

test('source/target firewall rejects semantic model-input fields', () => {
  assert.deepEqual(findFirewallViolations({ physicalObjects: [{ objectIndex: 0, center: { x: 0.2, y: 0.3 } }] }), [])
  assert.deepEqual(findFirewallViolations({ physicalObjects: [{ objectIndex: 0, midi: 60 }] }), ['modelInput.physicalObjects.0.midi'])
})

test('pitch and duration attach to frozen physical heads', () => {
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4 })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 60, 0.2)]]]))
  const target = targets.get(1)
  assert.equal(target.families.PITCH_STAFF[0].state, 'KNOWN')
  assert.deepEqual(target.families.PITCH_STAFF[0].value.writtenPitch, { step: 'C', alter: null, octave: 4 })
  assert.equal(target.families.DURATION[0].value.divisionsNormalizedQuarters, 1)
  assert.equal(target.families.DURATION[0].state, 'KNOWN')
})

test('attack and chord grouping use MusicXML onset/voice after alignment', () => {
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4 })}${pitched({ step: 'E', octave: 4, chord: true })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 60, 0.2), anchor('b', 64, 0.2)]]]))
  const target = targets.get(1)
  assert.equal(target.families.ATTACK[0].value.memberHeads, 2)
  assert.equal(target.families.ATTACK[0].state, 'KNOWN')
  assert.equal(target.families.CHORD[0].value.memberHeads, 2)
  assert.equal(target.families.CHORD[0].state, 'KNOWN')
})

test('lane labels are canonical and lane continuations are source-aligned', () => {
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4 })}${pitched({ step: 'D', octave: 4 })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 60, 0.2), anchor('b', 62, 0.4)]]]))
  const target = targets.get(1)
  assert.equal(target.families.LANE[0].value.laneRole, 'P1:lane-1')
  assert.equal(Object.hasOwn(target.families.LANE[0].value, 'voice'), false)
  assert.equal(target.families.LANE_CONTINUATION.length, 1)
  assert.equal(target.families.LANE_CONTINUATION[0].state, 'KNOWN')
})

test('tuplet ratio and member span are emitted from written MusicXML', () => {
  const tm = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="start" number="1"/></notations>'
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, duration: 2, extra: tm })}${pitched({ step: 'D', octave: 4, duration: 2, extra: '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' })}${pitched({ step: 'E', octave: 4, duration: 2, extra: '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><notations><tuplet type="stop" number="1"/></notations>' })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 60, 0.2), anchor('b', 62, 0.3), anchor('c', 64, 0.4)]]]))
  const label = targets.get(1).families.TUPLET[0]
  assert.deepEqual(label.value.ratio, { actualNotes: 3, normalNotes: 2 })
  assert.equal(label.value.memberEventCount, 3)
  assert.equal(label.state, 'KNOWN')
})

test('tie labels use tie/tied elements and exclude generic slurs', () => {
  const start = '<tie type="start"/><notations><tied type="start"/><slur type="start" number="1"/></notations>'
  const stop = '<tie type="stop"/><notations><tied type="stop"/><slur type="stop" number="1"/></notations>'
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, extra: start })}</measure><measure number="2">${pitched({ step: 'C', octave: 4, extra: stop })}</measure>`)
  const a1 = anchor('a', 60, 0.2)
  const a2 = { ...anchor('b', 60, 0.2), measureNumber: 2 }
  const { targets } = assemble(xml, new Map([[1, [a1]], [2, [a2]]]))
  const label = targets.get(1).families.TIE_SUSTAIN[0]
  assert.equal(label.state, 'KNOWN')
  assert.equal(label.value.distinguishFromSlur, true)
})

test('cross-staff relations require a canonical lane changing staff', () => {
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 5, staff: 1 })}${pitched({ step: 'C', octave: 4, staff: 2 })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 72, 0.2, 0), anchor('b', 60, 0.4, 1)]]]))
  assert.equal(targets.get(1).families.CROSS_STAFF.length, 1)
  assert.equal(targets.get(1).families.CROSS_STAFF[0].state, 'KNOWN')
})

test('ambiguous pitch-only fallback and unavailable rest alignment remain explicit', () => {
  const pitchedXml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, staff: 2 })}</measure>`)
  const pitchedResult = assemble(pitchedXml, new Map([[1, [anchor('a', 60, 0.2, 0)]]]))
  assert.equal(pitchedResult.targets.get(1).families.PITCH_STAFF[0].state, 'AMBIGUOUS')

  const restXml = scoreXml(`<measure number="1">${attributes}<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note></measure>`)
  const restResult = assemble(restXml, new Map([[1, []]]))
  assert.equal(restResult.targets.get(1).families.REST[0].state, 'UNAVAILABLE')
  assert.equal(restResult.targets.get(1).families.REST[0].reason, 'NO_FROZEN_SOURCE_REST_OBJECT_ALIGNMENT_IN_PHASE212S')
})

test('printed rests attach only after a frozen source object has a unique compatible truth event', () => {
  const sourceRest = {
    sourceRestId: 'sfr-fixture',
    state: 'KNOWN',
    staffRole: 'upper',
    sourceGlyphClass: 'quarter',
    center: { x: 0.4, y: 0.3 },
  }
  const truthRest = { id: 'P1-m1-n1', staff: 1, noteType: 'quarter', offsetQuarters: 1 }
  const result = matchSourceRestsToTruth([sourceRest], [truthRest])
  assert.deepEqual(result.mapping.get(truthRest.id), {
    sourceRestId: 'sfr-fixture',
    state: 'KNOWN',
    confidence: 0.98,
    method: 'UNIQUE_STAFF_AND_PRINTED_GLYPH_TYPE',
  })

  const incompatible = matchSourceRestsToTruth([sourceRest], [{ ...truthRest, noteType: 'eighth' }])
  assert.equal(incompatible.mapping.size, 0)
  assert.deepEqual(incompatible.unmatchedSourceIds, ['sfr-fixture'])
})

test('shared-head labels retain multiple semantic roles on one physical head', () => {
  const xml = scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, voice: 1 })}<backup><duration>4</duration></backup>${pitched({ step: 'C', octave: 4, voice: 2 })}</measure>`)
  const { targets } = assemble(xml, new Map([[1, [anchor('a', 60, 0.2)]]]))
  const label = targets.get(1).families.SHARED_HEAD[0]
  assert.equal(label.state, 'KNOWN')
  assert.equal(label.value.semanticRoleCount, 2)
})

test('layout-independent musical fingerprint detects alternate renders', () => {
  const first = parseWrittenNotation(scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, x: 10 })}</measure>`, 'One'))
  const second = parseWrittenNotation(scoreXml(`<measure number="1">${attributes}${pitched({ step: 'C', octave: 4, x: 900 })}</measure>`, 'Alternate title'))
  assert.equal(musicalFingerprints(first).transpositionInvariantSha256, musicalFingerprints(second).transpositionInvariantSha256)
  assert.equal(musicalFingerprints(first).exactMusicalSha256, musicalFingerprints(second).exactMusicalSha256)
})

test('generated source/target corpora are separate, referentially valid, and state-complete', () => {
  const campaign = path.join(repoRoot, 'tmp/campaign/piano-vision-phase212u')
  const readRecords = (name) => gunzipSync(readFileSync(path.join(campaign, name)))
    .toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  const sources = readRecords('source-input.jsonl.gz')
  const targets = readRecords('target-supervision.jsonl.gz')
  assert.equal(sources.length, 1288)
  assert.equal(targets.length, 1288)
  assert.deepEqual(
    sources.map((record) => record.metadata.exampleId),
    targets.map((record) => record.metadata.exampleId),
  )
  const sourceById = new Map(sources.map((record) => [record.metadata.exampleId, record]))
  assert.equal(sourceById.size, sources.length)
  const states = new Set(['KNOWN', 'AMBIGUOUS', 'UNAVAILABLE'])
  for (const target of targets) {
    const source = sourceById.get(target.metadata.exampleId)
    assert.ok(source)
    assert.deepEqual(findFirewallViolations(source.modelInput), [])
    const objectCount = source.modelInput.physicalObjects.length
    for (const family of Object.keys(target.families)) {
      for (const label of target.families[family]) {
        assert.ok(states.has(label.state))
        assert.ok(label.confidence >= 0 && label.confidence <= 1)
        assert.ok(label.objectIndexes.every((index) => Number.isInteger(index) && index >= 0 && index < objectCount))
        assert.equal(typeof label.provenance.sourceEvidence, 'string')
        assert.equal(typeof label.provenance.semanticEvidence, 'string')
      }
    }
  }
})

test('Phase 2.12V rest-enriched corpus preserves referential integrity and split coverage', () => {
  const campaign = path.join(repoRoot, 'tmp/campaign/piano-vision-phase212v')
  const readRecords = (name) => gunzipSync(readFileSync(path.join(campaign, name)))
    .toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  const sources = readRecords('source-input.jsonl.gz')
  const targets = readRecords('target-supervision.jsonl.gz')
  assert.equal(sources.length, 1288)
  assert.equal(targets.length, 1288)
  assert.deepEqual(
    sources.map((record) => record.metadata.exampleId),
    targets.map((record) => record.metadata.exampleId),
  )
  const sourceById = new Map(sources.map((record) => [record.metadata.exampleId, record]))
  let printedRests = 0
  let knownRestLabels = 0
  const positiveRestScoresBySplit = new Map()
  for (const target of targets) {
    const source = sourceById.get(target.metadata.exampleId)
    assert.ok(source)
    assert.deepEqual(findFirewallViolations(source.modelInput), [])
    const objectCount = source.modelInput.physicalObjects.length
    printedRests += source.modelInput.physicalObjects.filter((object) => object.kind === 'rest').length
    for (const label of target.families.REST) {
      assert.ok(label.objectIndexes.every((index) => Number.isInteger(index) && index >= 0 && index < objectCount))
      if (label.state === 'KNOWN' && label.isPositive) {
        knownRestLabels += 1
        if (!positiveRestScoresBySplit.has(target.metadata.split)) positiveRestScoresBySplit.set(target.metadata.split, new Set())
        positiveRestScoresBySplit.get(target.metadata.split).add(target.metadata.groupId)
      }
    }
  }
  assert.equal(printedRests, 522)
  assert.equal(knownRestLabels, 377)
  for (const split of ['train', 'validation', 'test']) {
    assert.ok((positiveRestScoresBySplit.get(split)?.size ?? 0) > 0)
  }
})
