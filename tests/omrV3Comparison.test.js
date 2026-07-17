import { describe, expect, it } from 'vitest'
import {
  buildOmrV3DisagreementTelemetry,
  compareOmrV2V3MusicXml,
  formatOmrV3ComparisonReport,
} from '../src/features/omr/v3/omrV3Comparison.js'
import {
  buildOmrV3DeveloperDiagnostics,
  selectOmrDeveloperMusicXml,
} from '../src/features/omr/v3/omrV3Diagnostics.js'
import { resolveOmrV3DeveloperPipelineOptions } from '../src/features/omr/omrDiagnosticFlags.js'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { rhythmicPianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'

const MINIMAL_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

const DIVERGENT_V3 = MINIMAL_V2.replace(
  '<pitch><step>D</step><octave>4</octave></pitch>',
  '<pitch><step>E</step><octave>4</octave></pitch>',
)

describe('OMR V3 comparison mode', () => {
  it('reports identical MusicXML with no disagreement categories', () => {
    const comparison = compareOmrV2V3MusicXml({
      v2MusicXml: MINIMAL_V2,
      v3MusicXml: MINIMAL_V2,
    })
    expect(comparison.status).toBe('identical')
    expect(comparison.byteIdentical).toBe(true)
    expect(comparison.disagreement.any).toBe(false)
    expect(buildOmrV3DisagreementTelemetry(comparison).disagreed).toBe(false)
  })

  it('categorizes pitch disagreements without retaining full MusicXML in telemetry', () => {
    const comparison = compareOmrV2V3MusicXml({
      v2MusicXml: MINIMAL_V2,
      v3MusicXml: DIVERGENT_V3,
      v2Confidence: { overall: 0.8 },
      v3Confidence: { overall: 0.7 },
    })
    expect(comparison.status).toBe('divergent')
    expect(comparison.disagreement.categories).toContain('pitch')
    expect(comparison.pitch.wrongPitchCount).toBeGreaterThan(0)
    expect(comparison.confidence.disagrees).toBe(true)

    const telemetry = buildOmrV3DisagreementTelemetry(comparison)
    expect(telemetry.disagreed).toBe(true)
    expect(telemetry.categories).toContain('pitch')
    expect(JSON.stringify(telemetry)).not.toMatch(/score-partwise/)
    expect(formatOmrV3ComparisonReport(comparison)).toContain('Pitch:')
  })

  it('selects developer MusicXML without implying runtime promotion', () => {
    const result = {
      musicXml: MINIMAL_V2,
      omrV3IndependentShadow: { musicXml: DIVERGENT_V3, status: 'ready' },
    }
    expect(selectOmrDeveloperMusicXml(result, 'v2').engine).toBe('v2')
    expect(selectOmrDeveloperMusicXml(result, 'v3')).toMatchObject({
      engine: 'v3',
      musicXml: DIVERGENT_V3,
    })
    const diagnostics = buildOmrV3DeveloperDiagnostics(result, { prefer: 'v3' })
    expect(diagnostics.preferredEngine).toBe('v3')
    expect(diagnostics.userVisibleEngine).toBe('v2')
    expect(diagnostics.musicXml.sideBySideAvailable).toBe(true)
  })

  it('keeps V2 user-visible in comparison mode while attaching a structured report', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const base = {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      title: 'v3-compare-mode',
    }
    const production = await runPdfOmrPipeline('synthetic', base)
    const compared = await runPdfOmrPipeline('synthetic', {
      ...base,
      omrV3Compare: true,
    })

    expect(compared.musicXml).toBe(production.musicXml)
    expect(compared.omrV3IndependentShadow).toMatchObject({
      status: 'ready',
      promotedToRuntime: false,
    })
    expect(compared.omrV3Comparison).toBeTruthy()
    expect(compared.omrV3Comparison.status).toMatch(/identical|divergent/)
    expect(compared.omrV3RuntimePromotion).toMatchObject({
      comparisonMode: true,
      promotedToRuntime: false,
      decision: 'hold-comparison-mode',
    })
    expect(compared.omrV3RuntimePromotion.disagreement).toMatchObject({
      disagreed: expect.any(Boolean),
      categories: expect.any(Array),
    })
    expect(compared.omrV3DeveloperDiagnostics?.timing).toBeTruthy()
    expect(compared.omrV3DeveloperDiagnostics?.musicXml?.v2).toBe(production.musicXml)
  })

  it('honors developer compare flags outside production builds', () => {
    const options = resolveOmrV3DeveloperPipelineOptions({
      v3Compare: true,
      v3Prefer: true,
      v3Telemetry: true,
    })
    expect(options).toMatchObject({
      omrV3Compare: true,
      omrV3Shadow: true,
      preferV3Output: true,
      logV3Telemetry: true,
    })
  })
})
