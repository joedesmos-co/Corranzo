/**
 * Stable local key for aggregating stats per score.
 *
 * Canonical ledger identity (V2): one namespace for manual + auto.
 * - Exact score identity when a content fingerprint/filename is known:
 *   `piece:<fingerprint>` or `piece:<slug(filename)>`.
 * - Title-only fallback (manual log without an open score):
 *   `piece:<slug(title)>` in the SAME namespace (legacy `manual:<slug>`
 *   remains readable via migration).
 * Manual and automatic views join on this canonical record instead of
 * parallel `manual:` vs `piece:` identities. When an exact fingerprint is
 * unavailable, callers may pass the current score's pieceId explicitly so a
 * manual entry joins the same work; otherwise the title slug is used and a
 * title-alias map lets views display joined history.
 */
import { DEMO_PIECE } from '../../dev/fixturePaths.js'

export function slugifyPieceTitle(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function stripExtension(fileName = '') {
  return String(fileName).replace(/\.[^.]+$/, '')
}

/**
 * Resolve one canonical piece identity shared by manual + auto writers.
 * Returns { pieceId, title, scoreFingerprint }.
 */
export function resolveCanonicalPieceId({
  pdfFingerprint = null,
  pdfFileName = null,
  musicXmlFileName = null,
  pieceTitle = null,
  pieceId = null,
} = {}) {
  if (pieceId && String(pieceId).trim()) {
    const explicit = String(pieceId).trim().slice(0, 160)
    // Normalize legacy manual: prefix into the canonical piece: namespace.
    if (explicit.startsWith('manual:')) {
      const slug = explicit.slice('manual:'.length)
      return {
        pieceId: `piece:${slug}`,
        title: normalizePieceTitle(pieceTitle) ?? slug,
        scoreFingerprint: pdfFingerprint ?? null,
      }
    }
    return {
      pieceId: explicit,
      title: normalizePieceTitle(pieceTitle) ?? explicit,
      scoreFingerprint: pdfFingerprint ?? null,
    }
  }
  if (pdfFingerprint && String(pdfFingerprint).trim()) {
    const fingerprint = String(pdfFingerprint).trim()
    const title =
      normalizePieceTitle(pieceTitle) ??
      stripExtension(pdfFileName ?? musicXmlFileName ?? '').trim().slice(0, 120) ??
      'Untitled piece'
    return { pieceId: `piece:${fingerprint}`, title, scoreFingerprint: fingerprint }
  }
  const name = musicXmlFileName || pdfFileName
  if (name) {
    const slug = slugifyPieceTitle(stripExtension(name))
    const title = normalizePieceTitle(pieceTitle) ?? stripExtension(name).trim().slice(0, 120) ?? 'Untitled piece'
    if (slug) {
      return { pieceId: `piece:${slug}`, title, scoreFingerprint: null }
    }
  }
  if (pieceTitle && String(pieceTitle).trim()) {
    const slug = slugifyPieceTitle(pieceTitle)
    const title = normalizePieceTitle(pieceTitle)
    if (slug) {
      return { pieceId: `piece:${slug}`, title, scoreFingerprint: null }
    }
  }
  return { pieceId: null, title: 'Untitled piece', scoreFingerprint: null }
}

function normalizePieceTitle(title) {
  if (typeof title === 'string' && title.trim()) {
    return title.trim().slice(0, 120)
  }
  return null
}

/** Title-alias slug for joining manual + auto views of the same work. */
export function titleAliasKey(title) {
  return slugifyPieceTitle(title)
}

export function buildPieceIdentity({
  pdfMeta,
  musicXmlSource,
  timingMap,
  isDemoPiece = false,
}) {
  const pdfName = pdfMeta?.fileName ?? ''
  const timingName = musicXmlSource?.fileName ?? timingMap?.fileName ?? ''
  const id =
    pdfName && timingName ? `${pdfName}::${timingName}` : pdfName || timingName || 'unknown-piece'

  let title = timingMap?.title?.trim()
  if (!title && pdfName) {
    title = pdfName.replace(/\.pdf$/i, '').replace(/^Demo — /i, '')
  }
  if (!title) {
    title = isDemoPiece ? `${DEMO_PIECE.title} (sample)` : 'Untitled piece'
  }

  return {
    id,
    title: title.slice(0, 120),
    isDemoPiece: Boolean(isDemoPiece),
  }
}
