import { describe, expect, it } from 'vitest'
import {
  CONTENT_SIGNALS,
  FRAGMENT_PATTERNS,
  PROVENANCE,
  classifyCorpus,
  classifyProvenance,
} from '../src/features/omr/guitar/provenance.js'

const REAL_CONTENT = `<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1">
<part-name>Guitar</part-name></score-part></part-list><part id="P1">
<measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch>
<duration>4</duration></note></measure></part></score-partwise>`

const OMR_CONTENT = `<?xml version="1.0"?><score-partwise version="3.1">
<direction><words>Generated from PDF — may contain mistakes.</words></direction>
<part id="P1"><measure number="1"><note id="sfnh-p1-n-x1-y2">
<pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>`

describe('classifyProvenance', () => {
  it('trusts an explicit manifest assertion above every heuristic', () => {
    const verdict = classifyProvenance({
      path: 'tmp/whatever.musicxml',
      text: OMR_CONTENT,
      declared: { provenance: PROVENANCE.REAL_PRINTED, licence: 'CC0-1.0' },
    })
    expect(verdict.provenance).toBe(PROVENANCE.REAL_PRINTED)
    expect(verdict.rule).toBe('declared-manifest')
    expect(verdict.labelable).toBe(true)
  })

  it('treats a scratch directory as machine output regardless of content', () => {
    // 144 tracked tmp/ scores carry no disclaimer at all, so a content-only
    // policy would misclassify them.
    const verdict = classifyProvenance({ path: 'tmp/omr-autonomous/final-register/generated/x.musicxml', text: REAL_CONTENT })
    expect(verdict.provenance).toBe(PROVENANCE.GENERATED)
    expect(verdict.rule).toBe('scratch-path-policy')
    expect(verdict.labelable).toBe(false)
  })

  it('catches the OMR disclaimer and engine note ids outside scratch dirs', () => {
    const verdict = classifyProvenance({ path: 'datasets/x/generated.musicxml', text: OMR_CONTENT })
    expect(verdict.provenance).toBe(PROVENANCE.GENERATED)
    expect(verdict.rule).toBe('content-signal')
  })

  it('catches an .omr. suffix', () => {
    const verdict = classifyProvenance({
      path: 'datasets/scratch/guitar-tab-sparse-vector.omr.musicxml',
      text: REAL_CONTENT,
    })
    expect(verdict.provenance).toBe(PROVENANCE.GENERATED)
  })

  it('catches a shadow-IR file', () => {
    const verdict = classifyProvenance({ path: 'datasets/runs/live-v3i.musicxml', text: REAL_CONTENT })
    expect(verdict.provenance).toBe(PROVENANCE.GENERATED)
  })

  it('treats an extracted fragment as generated and ask for review', () => {
    const verdict = classifyProvenance({
      path: 'datasets/musical-structure-sprint-1/musicxml-snippets/01-minecraft-p1-m4-chord-control.musicxml',
      text: REAL_CONTENT,
    })
    expect(verdict.provenance).toBe(PROVENANCE.GENERATED)
    expect(verdict.requiresHumanReview).toBe(true)
  })

  it('never defaults an unrecognised file to real', () => {
    const verdict = classifyProvenance({ path: 'datasets/mystery/score.musicxml', text: REAL_CONTENT })
    expect(verdict.provenance).toBe(PROVENANCE.UNLABELLED)
    expect(verdict.labelable).toBe(false)
    expect(verdict.requiresHumanReview).toBe(true)
  })

  it('treats a real PDF with no truth as unlabelled, not real-printed', () => {
    const verdict = classifyProvenance({ path: 'corranzo-holdout-intake/canon-in-d-pachelbel-guitar-tab.pdf' })
    expect(verdict.provenance).toBe(PROVENANCE.UNLABELLED)
    expect(verdict.labelable).toBe(false)
  })

  it('marks only real-printed and synthetic-cc0 as labelable', () => {
    expect(classifyProvenance({ path: 'a/x.musicxml', declared: { provenance: PROVENANCE.REAL_PRINTED } }).labelable).toBe(true)
    expect(classifyProvenance({ path: 'a/x.musicxml', declared: { provenance: PROVENANCE.SYNTHETIC_CC0 } }).labelable).toBe(true)
    expect(classifyProvenance({ path: 'a/x.musicxml', declared: { provenance: PROVENANCE.GENERATED } }).labelable).toBe(false)
    expect(classifyProvenance({ path: 'a/x.musicxml', declared: { provenance: PROVENANCE.UNLABELLED } }).labelable).toBe(false)
  })

  it('always records why it decided', () => {
    for (const verdict of [
      classifyProvenance({ path: 'a/x.musicxml', declared: { provenance: PROVENANCE.REAL_PRINTED } }),
      classifyProvenance({ path: 'tmp/x.musicxml' }),
      classifyProvenance({ path: 'a/y.musicxml', text: REAL_CONTENT }),
    ]) {
      expect(verdict.reasons.length).toBeGreaterThan(0)
      expect(verdict.rule).toBeTruthy()
    }
  })
})

describe('classifyCorpus', () => {
  it('summarises counts and surfaces ambiguity instead of resolving it', () => {
    const summary = classifyCorpus([
      { path: 'a/real.musicxml', declared: { provenance: PROVENANCE.REAL_PRINTED } },
      { path: 'a/cc0.musicxml', declared: { provenance: PROVENANCE.SYNTHETIC_CC0 } },
      { path: 'tmp/omr-out.musicxml', text: OMR_CONTENT },
      { path: 'a/unknown.musicxml', text: REAL_CONTENT },
    ])
    expect(summary.total).toBe(4)
    expect(summary.counts[PROVENANCE.REAL_PRINTED]).toBe(1)
    expect(summary.counts[PROVENANCE.SYNTHETIC_CC0]).toBe(1)
    expect(summary.counts[PROVENANCE.GENERATED]).toBe(1)
    expect(summary.counts[PROVENANCE.UNLABELLED]).toBe(1)
    expect(summary.labelableCount).toBe(2)
    expect(summary.requiresReview.map((entry) => entry.path)).toEqual(['a/unknown.musicxml'])
  })

  it('reports a corpus with no labelable material as such', () => {
    const summary = classifyCorpus(Array.from({ length: 5 }, (_v, i) => ({ path: `tmp/o${i}.musicxml`, text: OMR_CONTENT })))
    expect(summary.labelableCount).toBe(0)
    expect(summary.generatedCount).toBe(5)
  })
})

describe('signal coverage', () => {
  it('every content signal has an id and a test', () => {
    for (const signal of CONTENT_SIGNALS) {
      expect(signal.id).toBeTruthy()
      expect(typeof signal.test).toBe('function')
    }
  })

  it('every fragment pattern is anchored enough to be specific', () => {
    for (const pattern of FRAGMENT_PATTERNS) {
      expect(pattern.test('datasets/a/b.musicxml')).toBe(false)
    }
  })
})
