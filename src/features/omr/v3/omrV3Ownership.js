/** Symbol ownership and onset-column construction for the OMR V3 shadow IR. */

import {
  createOmrDocumentIR,
  createOmrMeasureColumnIR,
  createOmrOnsetColumnIR,
  createOmrPageIR,
  createOmrStaffGroupIR,
  createOmrSystemIR,
  createOmrV3Diagnostic,
  createOmrV3Id,
  OMR_V3_DIAGNOSTIC_SEVERITY,
  OMR_V3_NOTATION_TYPE,
} from './omrV3Ir.js'

const DEFAULT_ONSET_TOLERANCE = 0.006
const MAX_ATTACHMENT_DISTANCE = 0.045
const STAFF_VERTICAL_MARGIN = 0.035

const KIND_ALIASES = new Map([
  ['note', 'notehead'],
  ['note-head', 'notehead'],
  ['notehead', 'notehead'],
  ['rest', 'rest'],
  ['stem', 'stem'],
  ['beam', 'beam'],
  ['accidental', 'accidental'],
  ['sharp', 'accidental'],
  ['flat', 'accidental'],
  ['natural', 'accidental'],
  ['tab-digit', 'tab-digit'],
  ['tab-fret', 'tab-digit'],
  ['fret', 'tab-digit'],
  ['lyric', 'excluded'],
  ['lyrics', 'excluded'],
  ['chord-symbol', 'excluded'],
  ['watermark', 'excluded'],
  ['page-number', 'excluded'],
  ['tempo-text', 'excluded'],
  ['text', 'text'],
])

const COLUMN_COLLECTION = {
  notehead: 'noteheads',
  rest: 'rests',
  stem: 'stems',
  beam: 'beams',
  accidental: 'accidentals',
  'tab-digit': 'tabDigits',
  excluded: 'excludedSymbols',
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function average(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0
}

function symbolKind(symbol) {
  const raw = String(symbol?.kind ?? symbol?.symbolType ?? symbol?.type ?? '').toLowerCase()
  return KIND_ALIASES.get(raw) ?? (raw || 'unknown')
}

function sourceBox(symbol) {
  const box = symbol?.geometry ?? symbol?.boundingBox ?? symbol?.bbox ?? {}
  const width = Number(box.width ?? symbol?.width ?? 0)
  const height = Number(box.height ?? symbol?.height ?? 0)
  const hasCenterX = Number.isFinite(symbol?.cx) || Number.isFinite(box?.cx)
  const hasCenterY = Number.isFinite(symbol?.cy) || Number.isFinite(box?.cy)
  const centerX = Number(symbol?.cx ?? box?.cx)
  const centerY = Number(symbol?.cy ?? box?.cy)
  return {
    x: hasCenterX ? centerX - width / 2 : Number(box.x ?? symbol?.x),
    y: hasCenterY ? centerY - height / 2 : Number(box.y ?? symbol?.y),
    width,
    height,
    space: box.space ?? symbol?.space ?? 'normalized',
  }
}

function normalizedBox(symbol, page) {
  const raw = sourceBox(symbol)
  const xScale = raw.space === 'pixels' ? page.width : 1
  const yScale = raw.space === 'pixels' ? page.height : 1
  const x = raw.x / xScale
  const y = raw.y / yScale
  const width = raw.width / xScale
  const height = raw.height / yScale
  if (![x, y, width, height].every(Number.isFinite)) return null
  const boundedX = clamp(x)
  const boundedY = clamp(y)
  return {
    x: boundedX,
    y: boundedY,
    width: clamp(width, 0, 1 - boundedX),
    height: clamp(height, 0, 1 - boundedY),
    space: 'normalized',
  }
}

function center(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

function pointBoxDistance(point, box) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width))
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height))
  return Math.hypot(dx, dy)
}

function allStaffEntries(system) {
  return (system.staffGroups ?? []).flatMap((group) =>
    (group.staves ?? []).map((staff) => ({ group, staff })),
  )
}

function ownerForSymbol(page, geometry) {
  const point = center(geometry)
  const systemCandidates = (page.systems ?? [])
    .map((system) => ({ system, distance: pointBoxDistance(point, system.boundingBox) }))
    .filter((entry) => entry.distance <= STAFF_VERTICAL_MARGIN)
    .sort((left, right) => left.distance - right.distance)
  const system = systemCandidates[0]?.system
  if (!system) return null

  const staffEntry = allStaffEntries(system)
    .map((entry) => ({
      ...entry,
      distance: pointBoxDistance(point, {
        ...entry.staff.boundingBox,
        y: entry.staff.boundingBox.y - STAFF_VERTICAL_MARGIN,
        height: entry.staff.boundingBox.height + STAFF_VERTICAL_MARGIN * 2,
      }),
    }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (!staffEntry || staffEntry.distance > STAFF_VERTICAL_MARGIN) return null

  const measures = system.measureColumns ?? []
  const measure = measures.find(
    (candidate, index) =>
      point.x >= candidate.xStart &&
      (point.x < candidate.xEnd || (index === measures.length - 1 && point.x <= candidate.xEnd)),
  )
  if (!measure) return null
  return { system, group: staffEntry.group, staff: staffEntry.staff, measure, point }
}

function normalizedSymbol(symbol, geometry, owner, page, index) {
  let kind = symbolKind(symbol)
  const text = symbol?.text == null ? null : String(symbol.text)
  if (
    (kind === 'text' || kind === 'unknown') &&
    owner.staff.notationType === OMR_V3_NOTATION_TYPE.TAB &&
    /^\d+$/.test(text ?? '')
  ) {
    kind = 'tab-digit'
  } else if (kind === 'text') {
    kind = 'excluded'
  }
  const sourceId = symbol?.symbolId ?? symbol?.id ?? symbol?.sourceId ?? `symbol-${index}`
  const symbolId = String(
    symbol?.symbolId ?? createOmrV3Id('symbol', page.pageId, sourceId, index),
  )
  const confidence = clamp(Number(symbol?.confidence ?? 0.6))
  return {
    symbolId,
    kind,
    text,
    value: symbol?.value ?? text,
    grace: Boolean(symbol?.grace || symbol?.isGrace),
    string: Number.isFinite(symbol?.string) ? Number(symbol.string) : null,
    fret: Number.isFinite(symbol?.fret) ? Number(symbol.fret) : null,
    lineIndex: Number.isFinite(symbol?.lineIndex) ? Number(symbol.lineIndex) : null,
    pitch: symbol?.pitch && typeof symbol.pitch === 'object' ? { ...symbol.pitch } : null,
    midi: Number.isFinite(symbol?.midi) ? Number(symbol.midi) : null,
    onsetDivisions: Number.isFinite(symbol?.onsetDivisions)
      ? Number(symbol.onsetDivisions)
      : null,
    durationDivisions: Number.isFinite(symbol?.durationDivisions)
      ? Number(symbol.durationDivisions)
      : null,
    duration:
      symbol?.duration && typeof symbol.duration === 'object' ? { ...symbol.duration } : null,
    voiceHint: Number.isFinite(symbol?.voiceHint) ? Number(symbol.voiceHint) : null,
    stemDirection: symbol?.stemDirection ?? null,
    stemGroupId: symbol?.stemGroupId ?? null,
    beamGroupId: symbol?.beamGroupId ?? null,
    tieStart: Boolean(symbol?.tieStart),
    tieStop: Boolean(symbol?.tieStop),
    tieId: symbol?.tieId ?? null,
    slurStart: Boolean(symbol?.slurStart),
    slurStop: Boolean(symbol?.slurStop),
    slurId: symbol?.slurId ?? null,
    crossStaffTargetStaffId: symbol?.crossStaffTargetStaffId ?? null,
    technical: symbol?.technical && typeof symbol.technical === 'object' ? { ...symbol.technical } : {},
    geometry,
    sourceGeometry: sourceBox(symbol),
    ownership: {
      pageId: page.pageId,
      systemId: owner.system.systemId,
      staffGroupId: owner.group.staffGroupId,
      staffId: owner.staff.staffId,
      measureId: owner.measure.measureId,
      onsetColumnId: null,
    },
    confidence: {
      overall: confidence,
      stages: { 'symbol-ownership': confidence },
    },
    sourceRefs: [String(sourceId)],
  }
}

function lineKey(symbol) {
  if (Number.isFinite(symbol.string)) return `string:${symbol.string}`
  if (Number.isFinite(symbol.lineIndex)) return `line:${symbol.lineIndex}`
  return `y:${Math.round(center(symbol.geometry).y * 500)}`
}

function canMergeTabDigits(left, right) {
  if (left.kind !== 'tab-digit' || right.kind !== 'tab-digit') return false
  if (left.ownership.staffId !== right.ownership.staffId) return false
  if (left.ownership.measureId !== right.ownership.measureId) return false
  if (lineKey(left) !== lineKey(right)) return false
  if (!/^\d$/.test(left.text ?? '') || !/^\d$/.test(right.text ?? '')) return false
  const leftRight = left.geometry.x + left.geometry.width
  const gap = right.geometry.x - leftRight
  const width = Math.max(left.geometry.width, right.geometry.width, 0.004)
  return gap >= -width * 0.35 && gap <= Math.max(0.004, width * 0.9)
}

function mergeTabDigitRun(run) {
  if (run.length === 1) return run[0]
  const first = run[0]
  const text = run.map((symbol) => symbol.text).join('')
  const xEnd = Math.max(...run.map((symbol) => symbol.geometry.x + symbol.geometry.width))
  const yEnd = Math.max(...run.map((symbol) => symbol.geometry.y + symbol.geometry.height))
  return {
    ...first,
    symbolId: createOmrV3Id('symbol', 'tab-fret', ...run.map((symbol) => symbol.symbolId)),
    text,
    value: Number(text),
    geometry: {
      x: first.geometry.x,
      y: Math.min(...run.map((symbol) => symbol.geometry.y)),
      width: xEnd - first.geometry.x,
      height: yEnd - Math.min(...run.map((symbol) => symbol.geometry.y)),
      space: 'normalized',
    },
    sourceGeometry: first.sourceGeometry,
    componentSourceGeometry: run.map((symbol) => symbol.sourceGeometry),
    sourceRefs: run.flatMap((symbol) => symbol.sourceRefs),
    componentSymbolIds: run.map((symbol) => symbol.symbolId),
    confidence: {
      overall: average(run.map((symbol) => symbol.confidence.overall)),
      stages: {
        'symbol-ownership': average(run.map((symbol) => symbol.confidence.overall)),
        'multi-digit-fret-merge': average(run.map((symbol) => symbol.confidence.overall)),
      },
    },
  }
}

function mergeMultiDigitFrets(symbols) {
  const sorted = [...symbols].sort(
    (left, right) =>
      left.ownership.staffId.localeCompare(right.ownership.staffId) ||
      left.ownership.measureId.localeCompare(right.ownership.measureId) ||
      lineKey(left).localeCompare(lineKey(right)) ||
      left.geometry.x - right.geometry.x,
  )
  const result = []
  let run = []
  for (const symbol of sorted) {
    if (run.length === 0 || canMergeTabDigits(run[run.length - 1], symbol)) {
      run.push(symbol)
    } else {
      result.push(...(run[0]?.kind === 'tab-digit' ? [mergeTabDigitRun(run)] : run))
      run = [symbol]
    }
  }
  if (run.length > 0) {
    result.push(...(run[0]?.kind === 'tab-digit' ? [mergeTabDigitRun(run)] : run))
  }
  return result.sort((left, right) => center(left.geometry).x - center(right.geometry).x)
}

function isAnchor(symbol) {
  return symbol.kind === 'notehead' || symbol.kind === 'rest' || symbol.kind === 'tab-digit'
}

function buildOnsetClusters(measure, symbols, onsetTolerance) {
  const anchors = symbols
    .filter((symbol) => symbol.ownership.measureId === measure.measureId && isAnchor(symbol))
    .sort((left, right) => center(left.geometry).x - center(right.geometry).x)
  const clusters = []
  for (const symbol of anchors) {
    const x = center(symbol.geometry).x
    const compatible = [...clusters]
      .reverse()
      .find((cluster) => cluster.grace === symbol.grace && Math.abs(cluster.x - x) <= onsetTolerance)
    if (compatible) {
      compatible.symbols.push(symbol)
      compatible.x = average(compatible.symbols.map((entry) => center(entry.geometry).x))
    } else {
      clusters.push({ x, grace: symbol.grace, symbols: [symbol] })
    }
  }
  return clusters.sort((left, right) => left.x - right.x || Number(left.grace) - Number(right.grace))
}

function nearestCluster(symbol, clusters) {
  if (clusters.length === 0) return null
  const x = center(symbol.geometry).x
  const candidates = clusters
    .map((cluster) => ({ cluster, distance: Math.abs(cluster.x - x) }))
    .sort((left, right) => left.distance - right.distance)
  if (symbol.kind === 'excluded') return candidates[0].cluster
  return candidates[0].distance <= MAX_ATTACHMENT_DISTANCE ? candidates[0].cluster : null
}

function materializeOnsetColumns(measure, measureSymbols, onsetTolerance) {
  const clusters = buildOnsetClusters(measure, measureSymbols, onsetTolerance)
  const attached = new Map(clusters.map((cluster) => [cluster, [...cluster.symbols]]))
  for (const symbol of measureSymbols.filter((entry) => !isAnchor(entry))) {
    const cluster = nearestCluster(symbol, clusters)
    if (cluster) attached.get(cluster).push(symbol)
  }

  const onsetColumns = clusters.map((cluster, index) => {
    const onsetColumnId = createOmrV3Id('onset', measure.measureId, cluster.x, cluster.grace, index)
    const members = attached.get(cluster)
    for (const symbol of members) symbol.ownership.onsetColumnId = onsetColumnId
    const collections = {
      noteheads: [],
      rests: [],
      stems: [],
      beams: [],
      accidentals: [],
      tabDigits: [],
      excludedSymbols: [],
    }
    for (const symbol of members) {
      const collection = COLUMN_COLLECTION[symbol.kind]
      if (collection) collections[collection].push(symbol.symbolId)
    }
    const width = measure.xEnd - measure.xStart
    return createOmrOnsetColumnIR({
      onsetColumnId,
      measureId: measure.measureId,
      x: cluster.x,
      measureRelativePosition: width > 0 ? clamp((cluster.x - measure.xStart) / width) : null,
      grace: cluster.grace,
      ...collections,
      confidence: {
        overall: average(cluster.symbols.map((symbol) => symbol.confidence.overall)),
        stages: {
          'onset-column-clustering': average(
            cluster.symbols.map((symbol) => symbol.confidence.overall),
          ),
        },
        evidence: [{ kind: 'anchor-count', value: cluster.symbols.length }],
      },
      sourceRefs: members.flatMap((symbol) => symbol.sourceRefs),
    })
  })
  return onsetColumns
}

function symbolsForStaff(symbols, staffId) {
  return symbols.filter((symbol) => symbol.ownership.staffId === staffId)
}

/** Assign one page's detector symbols without changing voice or note output. */
export function assignOmrV3PageSymbolOwnership(
  page,
  rawSymbols = [],
  { onsetTolerance = DEFAULT_ONSET_TOLERANCE } = {},
) {
  const assigned = []
  const unassigned = []
  const seenSymbolIds = new Set()
  rawSymbols.forEach((rawSymbol, index) => {
    const geometry = normalizedBox(rawSymbol, page)
    const owner = geometry ? ownerForSymbol(page, geometry) : null
    if (!geometry || !owner) {
      unassigned.push({
        ...rawSymbol,
        symbolId: String(
          rawSymbol?.symbolId ??
            createOmrV3Id('unassigned-symbol', page.pageId, rawSymbol?.id ?? index),
        ),
        rejectionReason: geometry ? 'no-safe-structural-owner' : 'invalid-source-geometry',
      })
      return
    }
    const normalized = normalizedSymbol(rawSymbol, geometry, owner, page, index)
    if (seenSymbolIds.has(normalized.symbolId)) {
      normalized.symbolId = createOmrV3Id('symbol', page.pageId, normalized.symbolId, index)
    }
    seenSymbolIds.add(normalized.symbolId)
    assigned.push(normalized)
  })
  const merged = mergeMultiDigitFrets(assigned)
  const symbolById = new Map(merged.map((symbol) => [symbol.symbolId, symbol]))

  const systems = (page.systems ?? []).map((system) => {
    const systemSymbols = merged.filter((symbol) => symbol.ownership.systemId === system.systemId)
    const measureColumns = (system.measureColumns ?? []).map((measure) => {
      const measureSymbols = systemSymbols.filter(
        (symbol) => symbol.ownership.measureId === measure.measureId,
      )
      const onsetColumns = materializeOnsetColumns(measure, measureSymbols, onsetTolerance)
      const unattached = measureSymbols.filter(
        (symbol) => !symbol.ownership.onsetColumnId && symbol.kind !== 'excluded',
      )
      return createOmrMeasureColumnIR({
        ...measure,
        onsetColumns,
        diagnostics: [
          ...(measure.diagnostics ?? []),
          ...(unattached.length
            ? [
                createOmrV3Diagnostic({
                  code: 'symbols-without-onset-owner',
                  severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
                  stage: 'symbol-ownership',
                  message: `${unattached.length} symbol(s) could not be attached to an onset column.`,
                  sourceRefs: unattached.flatMap((symbol) => symbol.sourceRefs),
                }),
              ]
            : []),
        ],
      })
    })
    const staffGroups = (system.staffGroups ?? []).map((group) =>
      createOmrStaffGroupIR({
        ...group,
        staves: (group.staves ?? []).map((staff) => ({
          ...staff,
          symbols: symbolsForStaff(systemSymbols, staff.staffId),
        })),
      }),
    )
    return createOmrSystemIR({ ...system, staffGroups, measureColumns })
  })
  const diagnostics = [
    ...(page.diagnostics ?? []),
    ...(unassigned.length
      ? [
          createOmrV3Diagnostic({
            code: 'unassigned-page-symbols',
            severity: OMR_V3_DIAGNOSTIC_SEVERITY.WARNING,
            stage: 'symbol-ownership',
            message: `${unassigned.length} symbol(s) had no safe structural owner.`,
            sourceRefs: unassigned.flatMap((symbol) => symbol.sourceRefs ?? []),
          }),
        ]
      : []),
  ]
  return {
    page: createOmrPageIR({
      ...page,
      systems,
      unassignedSymbols: [...(page.unassignedSymbols ?? []), ...unassigned],
      diagnostics,
    }),
    symbols: [...symbolById.values()],
    summary: {
      inputSymbolCount: rawSymbols.length,
      assignedSymbolCount: merged.length,
      unassignedSymbolCount: unassigned.length,
      excludedSymbolCount: merged.filter((symbol) => symbol.kind === 'excluded').length,
      onsetColumnCount: systems.reduce(
        (sum, system) =>
          sum +
          system.measureColumns.reduce(
            (measureSum, measure) => measureSum + measure.onsetColumns.length,
            0,
          ),
        0,
      ),
      mergedTabDigitCount: assigned.length - merged.length,
    },
  }
}

function pageSymbols(source, page) {
  if (source instanceof Map) {
    return source.get(page.pageId) ?? source.get(page.pageIndex) ?? []
  }
  if (Array.isArray(source)) {
    return source.filter(
      (symbol) =>
        symbol.pageId === page.pageId ||
        symbol.pageIndex === page.pageIndex ||
        (page.pageIndex === 0 && symbol.pageId == null && symbol.pageIndex == null),
    )
  }
  return source?.[page.pageId] ?? source?.[page.pageIndex] ?? []
}

/** Apply page ownership in document order and return evaluation-friendly summaries. */
export function assignOmrV3DocumentSymbolOwnership(
  document,
  { symbolsByPage = [], onsetTolerance = DEFAULT_ONSET_TOLERANCE } = {},
) {
  const summaries = []
  const symbols = []
  const pages = (document.pages ?? []).map((page) => {
    const result = assignOmrV3PageSymbolOwnership(page, pageSymbols(symbolsByPage, page), {
      onsetTolerance,
    })
    summaries.push({ pageId: page.pageId, ...result.summary })
    symbols.push(...result.symbols)
    return result.page
  })
  return {
    document: createOmrDocumentIR({ ...document, pages }),
    pages: summaries,
    symbols,
    totals: summaries.reduce(
      (totals, summary) => ({
        inputSymbolCount: totals.inputSymbolCount + summary.inputSymbolCount,
        assignedSymbolCount: totals.assignedSymbolCount + summary.assignedSymbolCount,
        unassignedSymbolCount: totals.unassignedSymbolCount + summary.unassignedSymbolCount,
        excludedSymbolCount: totals.excludedSymbolCount + summary.excludedSymbolCount,
        onsetColumnCount: totals.onsetColumnCount + summary.onsetColumnCount,
        mergedTabDigitCount: totals.mergedTabDigitCount + summary.mergedTabDigitCount,
      }),
      {
        inputSymbolCount: 0,
        assignedSymbolCount: 0,
        unassignedSymbolCount: 0,
        excludedSymbolCount: 0,
        onsetColumnCount: 0,
        mergedTabDigitCount: 0,
      },
    ),
  }
}
