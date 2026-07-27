/**
 * Content-derived score source identities (SHA-256 / FNV fallback).
 * Prefer these over filenames, object refs, or epoch alone when tracing
 * Piece A → Piece B MusicXML survival.
 */

function toBytes(input) {
  if (input == null) {
    return null
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  if (typeof input === 'string') {
    return new TextEncoder().encode(input)
  }
  return null
}

/** Fast non-crypto fingerprint for sync diagnostics / cache keys. */
export function fnv1aHashHex(input) {
  const bytes = toBytes(input)
  if (!bytes || bytes.byteLength === 0) {
    return null
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.byteLength; i += 1) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export async function sha256Hex(input) {
  const bytes = toBytes(input)
  if (!bytes || bytes.byteLength === 0) {
    return null
  }
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `fnv1a:${fnv1aHashHex(bytes)}`
}

export function contentIdentitySync(input) {
  const bytes = toBytes(input)
  if (!bytes || bytes.byteLength === 0) {
    return null
  }
  return {
    byteLength: bytes.byteLength,
    hash: fnv1aHashHex(bytes),
  }
}

export function describeMusicXmlContent(source, musicXmlString = null) {
  const fromSource = contentIdentitySync(source?.data)
  const fromString = musicXmlString != null ? contentIdentitySync(musicXmlString) : null
  return {
    fileName: source?.fileName ?? null,
    sourceType: source?.source ?? null,
    ownerPdfIdentity: source?.ownerPdfIdentity ?? null,
    byteLength: fromSource?.byteLength ?? fromString?.byteLength ?? 0,
    contentHash: fromSource?.hash ?? fromString?.hash ?? null,
    stringContentHash: fromString?.hash ?? null,
    measureCount: source?.omrMeta?.measureCount ?? null,
    noteCount: source?.omrMeta?.noteCount ?? null,
    durationSeconds: source?.omrMeta?.durationSeconds ?? null,
  }
}

export function describePdfContent(pdfMeta, pdfBuffer = null) {
  const bytes = contentIdentitySync(pdfBuffer)
  return {
    fileName: pdfMeta?.fileName ?? null,
    metaIdentity: pdfMeta
      ? `${pdfMeta.fileName ?? ''}::${pdfMeta.size ?? ''}::${pdfMeta.lastModified ?? ''}`
      : null,
    byteLength: bytes?.byteLength ?? pdfMeta?.size ?? null,
    contentHash: bytes?.hash ?? null,
  }
}

export function describePlaybackEvents(events, limit = 8) {
  if (!Array.isArray(events) || events.length === 0) {
    return { count: 0, first: [] }
  }
  return {
    count: events.length,
    first: events.slice(0, limit).map((event) => ({
      midi: event.midi ?? null,
      name: event.name ?? null,
      scoreTimeSeconds: event.scoreTimeSeconds ?? event.timeSeconds ?? null,
      measureNumber: event.measureNumber ?? null,
    })),
  }
}

/** Append-only in-memory trace for browser automation. */
const TRACE_BUFFER_MAX = 80

export function pushScoreSourceContentTrace(phase, payload) {
  if (typeof window === 'undefined') {
    return
  }
  const entry = {
    phase,
    at: Date.now(),
    ...payload,
  }
  const bag = window.__SCOREFLOW_SOURCE_TRACE__ ?? { entries: [] }
  bag.entries = [...(bag.entries ?? []), entry].slice(-TRACE_BUFFER_MAX)
  bag.latest = entry
  window.__SCOREFLOW_SOURCE_TRACE__ = bag
  try {
    console.info(`[score-source-content] ${phase}`, entry)
  } catch {
    // ignore
  }
}

export function readScoreSourceContentTrace() {
  if (typeof window === 'undefined') {
    return { entries: [] }
  }
  return window.__SCOREFLOW_SOURCE_TRACE__ ?? { entries: [] }
}
