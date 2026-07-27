/**
 * OMR Notation Fidelity — failure-layer taxonomy and case scoring.
 *
 * Independent of the frozen semantic evaluator. Primary acceptance evidence
 * for Notation Fidelity Sprint 1 is the manually verified real-score case set.
 *
 * Failure layers:
 *   1. undetected — symbol missing from detection
 *   2. wrong-attachment — detected but bound to the wrong note(s)
 *   3. emission — detected/attached but MusicXML wrong or incomplete
 *   4. renderer — MusicXML correct but Visual Practice overlay wrong
 */

export const NOTATION_FAILURE_LAYER = {
  UNDETECTED: 'undetected',
  WRONG_ATTACHMENT: 'wrong-attachment',
  EMISSION: 'emission',
  RENDERER: 'renderer',
  NONE: 'none',
}

export const NOTATION_SYMBOL_KIND = {
  TIE: 'tie',
  SLUR: 'slur',
  STACCATO: 'staccato',
  ACCENT: 'accent',
  TENUTO: 'tenuto',
  MARCATO: 'marcato',
  FERMATA: 'fermata',
  NONE: 'none',
}

/**
 * Extract notation symbols from parsed MusicXML timing notes.
 */
export function extractNotationSymbolsFromNotes(notes = []) {
  const symbols = []
  for (const note of notes) {
    if (note.isRest || note.midi == null) {
      continue
    }
    const measureNumber = note.measureNumber ?? null
    const midi = note.midi
    if (note.tieStart || note.ties?.some((t) => t.type === 'start')) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.TIE,
        role: 'start',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.tieStop || note.ties?.some((t) => t.type === 'stop')) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.TIE,
        role: 'stop',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    for (const slur of note.slurs ?? []) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.SLUR,
        role: slur.type,
        number: slur.number ?? '1',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.staccato) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.STACCATO,
        role: 'mark',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.accent) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.ACCENT,
        role: 'mark',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.tenuto) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.TENUTO,
        role: 'mark',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.marcato) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.MARCATO,
        role: 'mark',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
    if (note.fermata) {
      symbols.push({
        kind: NOTATION_SYMBOL_KIND.FERMATA,
        role: 'mark',
        measureNumber,
        midi,
        onsetDivision: note.onsetDivision ?? note.startDivision ?? null,
      })
    }
  }
  return symbols
}

function symbolKey(symbol) {
  return [
    symbol.kind,
    symbol.role ?? '',
    symbol.measureNumber ?? '',
    symbol.midi ?? '',
    symbol.number ?? '',
  ].join('|')
}

/**
 * Score one manually verified case against extracted generated symbols.
 *
 * @param {object} expectedCase
 * @param {object[]} generatedSymbols
 * @param {{ visualMarkingsMatchMusicXml?: boolean }} [options]
 */
export function scoreNotationFidelityCase(expectedCase, generatedSymbols = [], options = {}) {
  const expectedKind = expectedCase.expectedSymbol ?? NOTATION_SYMBOL_KIND.NONE
  const expectAbsent = expectedCase.expectAbsent === true || expectedKind === NOTATION_SYMBOL_KIND.NONE

  const candidates = generatedSymbols.filter((symbol) => {
    if (expectedKind !== NOTATION_SYMBOL_KIND.NONE && symbol.kind !== expectedKind) {
      return false
    }
    if (
      Number.isFinite(expectedCase.measureNumber) &&
      Number.isFinite(symbol.measureNumber) &&
      symbol.measureNumber !== expectedCase.measureNumber
    ) {
      return false
    }
    if (
      Number.isFinite(expectedCase.midi) &&
      Number.isFinite(symbol.midi) &&
      symbol.midi !== expectedCase.midi
    ) {
      return false
    }
    if (expectedCase.role && symbol.role && symbol.role !== expectedCase.role) {
      return false
    }
    return true
  })

  let status = 'fn'
  let failureLayer = NOTATION_FAILURE_LAYER.UNDETECTED
  let matched = null

  if (expectAbsent) {
    if (candidates.length === 0) {
      status = 'tn'
      failureLayer = NOTATION_FAILURE_LAYER.NONE
    } else {
      status = 'fp'
      failureLayer = NOTATION_FAILURE_LAYER.WRONG_ATTACHMENT
      matched = candidates[0]
    }
  } else if (candidates.length === 0) {
    status = 'fn'
    failureLayer = NOTATION_FAILURE_LAYER.UNDETECTED
  } else {
    matched = candidates[0]
    const attachmentOk =
      (expectedCase.midi == null || matched.midi === expectedCase.midi) &&
      (expectedCase.measureNumber == null || matched.measureNumber === expectedCase.measureNumber)
    if (!attachmentOk) {
      status = 'fp'
      failureLayer = NOTATION_FAILURE_LAYER.WRONG_ATTACHMENT
    } else if (options.visualMarkingsMatchMusicXml === false) {
      status = 'tp'
      failureLayer = NOTATION_FAILURE_LAYER.RENDERER
    } else {
      status = 'tp'
      failureLayer = NOTATION_FAILURE_LAYER.NONE
    }
  }

  return {
    caseId: expectedCase.id,
    source: expectedCase.source,
    expectedSymbol: expectedKind,
    status,
    failureLayer,
    matched,
    detected: candidates,
    notes: expectedCase.notes ?? null,
  }
}

export function summarizeNotationFidelityResults(results = []) {
  const byKind = {}
  const byLayer = {
    [NOTATION_FAILURE_LAYER.UNDETECTED]: 0,
    [NOTATION_FAILURE_LAYER.WRONG_ATTACHMENT]: 0,
    [NOTATION_FAILURE_LAYER.EMISSION]: 0,
    [NOTATION_FAILURE_LAYER.RENDERER]: 0,
    [NOTATION_FAILURE_LAYER.NONE]: 0,
  }
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0

  for (const result of results) {
    byLayer[result.failureLayer] = (byLayer[result.failureLayer] ?? 0) + 1
    const kind = result.expectedSymbol ?? 'unknown'
    if (!byKind[kind]) {
      byKind[kind] = { tp: 0, fp: 0, fn: 0, tn: 0 }
    }
    byKind[kind][result.status] += 1
    if (result.status === 'tp') tp += 1
    if (result.status === 'fp') fp += 1
    if (result.status === 'fn') fn += 1
    if (result.status === 'tn') tn += 1
  }

  const total = results.length
  const correct = tp + tn
  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    tp,
    fp,
    fn,
    tn,
    byKind,
    byLayer,
  }
}

export function emptyCounts() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 }
}

/** Stable key helper for tests / reports. */
export function notationSymbolKey(symbol) {
  return symbolKey(symbol)
}
