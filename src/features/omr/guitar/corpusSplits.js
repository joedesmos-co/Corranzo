/**
 * Guitar Vision — frozen corpus splits with leakage guards.
 *
 * ## Why this is not a shuffle
 *
 * The real guitar corpus is 13 Mutopia scores. Within it, six of them
 * (`aguado-op03-1` … `op03-6`) are consecutive studies from **one collection**,
 * and three more (`bach-prelude-bwv997`, `bach-prelude-bwv999`,
 * `bach-menuet-bwv1006a`) come from **the same Lute Suite edition**. They share
 * an engraver, a font, measure widths, beam styles and even idiomatic figures.
 * A random per-score shuffle would put siblings on both sides of the split and
 * produce a validation number that measures memorisation of an engraving style
 * rather than generalisation. Splitting at the **collection** level is therefore
 * mandatory, not a nicety.
 *
 * ## The three separations this module enforces
 *
 * 1. **Split** — train / validation / held-out / diagnostic, assigned
 *    deterministically per *collection*, so a collection never straddles a split.
 * 2. **Validation role** — validation itself is partitioned into
 *    selection / temperature / risk by a stable hash of the collection. Fitting
 *    a temperature on data used to pick a checkpoint, or estimating risk on it,
 *    both bias the number that is supposed to be trustworthy.
 * 3. **Identity** — every sample is fingerprinted twice: once over the
 *    *canonicalised truth* (so a resaved copy of the same score is detected
 *    despite different bytes) and once over the *rendered page pixels* (so the
 *    same page is detected even when the truth file was edited). A digest
 *    appearing in two splits is a hard failure, not a warning.
 *
 * Held-out and diagnostic are sealed: {@link assertUsableForSelection} refuses
 * to build a selection set from them, so "we picked the best checkpoint on the
 * held-out set" cannot happen even by accident.
 */

import { createHash } from 'node:crypto'

export const SPLIT_MANIFEST_VERSION = 'guitar-splits/1.0'

export const SPLITS = Object.freeze({
  TRAIN: 'train',
  VALIDATION: 'validation',
  HELDOUT: 'heldout',
  DIAGNOSTIC: 'diagnostic',
})

/**
 * Why diagnostic exists as its own split: it is the "look at the hard cases and
 * understand the failure" pool. It is deliberately never a selection source, so
 * time spent staring at failures cannot leak into checkpoint choice.
 */
export const SEALED_SPLITS = Object.freeze([SPLITS.HELDOUT, SPLITS.DIAGNOSTIC])

/** Splits a checkpoint or model may be selected on. */
export const SELECTION_SPLITS = Object.freeze([SPLITS.TRAIN, SPLITS.VALIDATION])

export const VALIDATION_ROLES = Object.freeze({
  /** Used to choose checkpoints and architectures. */
  SELECTION: 'selection',
  /** Used to fit confidence temperature. Must not be a selection source. */
  TEMPERATURE: 'temperature',
  /** Used to report risk. Must not be a selection source. */
  RISK: 'risk',
})

/**
 * Provenance of a sample. `generated` is the dangerous one: an OMR output or a
 * model prediction is not ground truth, and training on it teaches the model its
 * own mistakes.
 */
export const PROVENANCE = Object.freeze({
  /** An authoritative score: published, or matched PDF + authoritative truth. */
  REAL_PRINTED: 'real-printed',
  /** Deliberately generated, deterministic, with a known-correct truth file. */
  SYNTHETIC_CC0: 'synthetic-cc0',
  /** Machine output. Never a label. */
  GENERATED: 'generated',
  /** A real PDF with no authoritative truth. Cannot be scored. */
  UNLABELLED: 'unlabelled',
})

/** Provenance values that may be used as a supervised label. */
export const LABELABLE_PROVENANCE = Object.freeze([PROVENANCE.REAL_PRINTED, PROVENANCE.SYNTHETIC_CC0])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Hex-encode bytes so digests can be taken without `Buffer`.
 *
 * These modules are imported by browser code, so they cannot depend on a Node
 * global. Hashing the hex string is a valid content digest — it is a different
 * encoding of the same bytes, with the same collision resistance — and it keeps
 * a single implementation usable in both environments.
 */
function sha256Bytes(bytes) {
  let hex = ''
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, '0')
  }
  return sha256(hex)
}

/**
 * Collections that must be grouped even though their piece ids look unrelated.
 *
 * Documented explicitly rather than inferred by regex, because a wrong guess
 * here silently leaks a whole edition across the split. Anything not listed falls
 * back to its own collection and is recorded with `groupConfidence: 'assumed'` so
 * a reviewer can see exactly which groupings were inferred.
 */
export const COLLECTION_OVERRIDES = Object.freeze({
  'guitar-aguado-op03-1': 'aguado-petites-pieces-op3',
  'guitar-aguado-op03-2': 'aguado-petites-pieces-op3',
  'guitar-aguado-op03-3': 'aguado-petites-pieces-op3',
  'guitar-aguado-op03-4': 'aguado-petites-pieces-op3',
  'guitar-aguado-op03-5': 'aguado-petites-pieces-op3',
  'guitar-aguado-op03-6': 'aguado-petites-pieces-op3',
  'guitar-bach-prelude-bwv997': 'bach-lute-suite',
  'guitar-bach-prelude-bwv999': 'bach-lute-suite',
  'guitar-bach-menuet-bwv1006a': 'bach-lute-suite',
  'guitar-ode-to-joy': 'ode-to-joy',
})

/** The collection a piece belongs to. */
export function collectionFor(pieceId) {
  return COLLECTION_OVERRIDES[pieceId] ?? `solo:${pieceId}`
}

/** True when the grouping was inferred rather than declared. */
export function collectionIsAssumed(pieceId) {
  return !(pieceId in COLLECTION_OVERRIDES)
}

/**
 * Canonicalised truth digest.
 *
 * Compares musical *content*, not bytes: whitespace, attribute order, comment
 * nodes and the disclaimer text are stripped, and notes are reduced to a sorted
 * structural summary. Without this, a score re-saved by a different tool looks
 * like new data and defeats the leakage check entirely.
 */
export function truthDigest(parsed) {
  const notes = (parsed.notes ?? [])
    .map((note) =>
      [
        note.partId ? 0 : 0, // part identity is not content
        note.measureNumber ?? 0,
        note.isRest ? 'rest' : `p${note.step ?? ''}${note.alter ?? ''}${note.octave ?? ''}`,
        round4(note.quarterTime ?? 0),
        round4(note.durationQuarters ?? 0),
        note.voice ?? 1,
        note.staff ?? 1,
        note.string ?? '-',
        note.fret ?? '-',
        note.dots ?? 0,
      ].join('|'),
    )
    .sort()
  const header = [
    parsed.title ?? '',
    (parsed.timeSignatures ?? []).map((ts) => `${ts.beats}/${ts.beatType}`).join(','),
    (parsed.keySignatures ?? []).map((ks) => ks.fifths).join(','),
  ].join('|')
  return sha256(`${header}\n${notes.join('\n')}`)
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

/**
 * Pixel digest over rendered page pixels.
 *
 * SHA-256 of the raw grayscale bytes, matching the Piano Vision convention. This
 * is the check that catches the same page re-encododed at a different DPI or
 * saved under a different name, which a truth digest alone would miss.
 */
export function pixelDigest(imageData) {
  const { width, height, data } = imageData
  // Luma from RGB/RGBA so a colour-space change does not change the digest.
  const gray = new Uint8Array(width * height)
  const channels = data.length / (width * height)
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * channels
    if (channels === 1) {
      gray[index] = data[offset]
    } else {
      gray[index] = Math.round(
        0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2],
      )
    }
  }
  return sha256Bytes(gray)
}

/** Digest of a whole file, so two different renders of one file still match. */
export function fileDigest(bytes) {
  if (bytes instanceof Uint8Array) return sha256Bytes(bytes)
  // Node callers pass a Buffer, which is a Uint8Array subclass; anything else is
  // stringified rather than silently digesting "[object Object]".
  if (bytes == null) return null
  return sha256(String(bytes))
}

/**
 * Deterministic bucket in [0, 1) for a string and a seed.
 *
 * Stable across processes and machines: no Date, no Math.random, no insertion
 * order. Two people regenerating the manifest must get identical output, or the
 * "frozen" split is not frozen.
 */
export function stableUnitInterval(key, seed) {
  const digest = createHash('sha256').update(`${seed}:${key}`).digest()
  // Use 53 bits so the value is exactly representable as a double.
  const high = digest.readUInt32BE(0)
  const low = digest.readUInt32BE(4) & 0x1fffff
  return (high * 2 ** 21 + low) / 2 ** 53
}

/** Which split a collection belongs to, given the target ratios. */
export function splitForCollection(collectionId, { seed, ratios }) {
  const total = Object.values(ratios).reduce((sum, value) => sum + value, 0)
  const point = stableUnitInterval(collectionId, seed)
  let cumulative = 0
  for (const [split, ratio] of Object.entries(ratios)) {
    cumulative += ratio / total
    if (point < cumulative) return split
  }
  return SPLITS.TRAIN
}

/**
 * Validation role for a collection. Partitioning by collection rather than by
 * score keeps the three roles independent at the same granularity as the split.
 */
export function validationRoleForCollection(collectionId, { seed, fractions } = {}) {
  const parts = fractions ?? { selection: 5, temperature: 2, risk: 3 }
  const total = parts.selection + parts.temperature + parts.risk
  const point = stableUnitInterval(`role:${collectionId}`, seed)
  if (point < parts.selection / total) return VALIDATION_ROLES.SELECTION
  if (point < (parts.selection + parts.temperature) / total) return VALIDATION_ROLES.TEMPERATURE
  return VALIDATION_ROLES.RISK
}

/**
 * Build a frozen split manifest.
 *
 * Assignment is by collection, deterministic in the seed, and refuses to build at
 * all if any sample is unlabelable-by-provenance and marked for training.
 */
export function buildSplitManifest({
  samples,
  seed = 20260928,
  ratios = { train: 0.6, validation: 0.2, heldout: 0.15, diagnostic: 0.05 },
  validationFractions,
  requireLabelableForTrain = true,
}) {
  const byCollection = new Map()
  for (const sample of samples) {
    const collection = sample.collectionId ?? collectionFor(sample.pieceId)
    if (!byCollection.has(collection)) byCollection.set(collection, [])
    byCollection.get(collection).push({ ...sample, collectionId: collection })
  }

  const records = []
  for (const [collectionId, members] of byCollection) {
    /**
     * A forced split bypasses the hash entirely. It exists for samples that
     * cannot participate in a supervised split at all — a real score with no
     * authoritative truth, say. Letting the hash place such a sample and then
     * relocating it afterwards is how an unlabelled PDF ends up being used for
     * training; forcing it up front makes that impossible.
     */
    const forced = members.find((member) => member.forcedSplit)?.forcedSplit ?? null
    const split = forced ?? splitForCollection(collectionId, { seed, ratios })
    const validationRole =
      split === SPLITS.VALIDATION
        ? validationRoleForCollection(collectionId, { seed, fractions: validationFractions })
        : null

    if (requireLabelableForTrain && split === SPLITS.TRAIN) {
      const unlabelable = members.filter(
        (member) => !LABELABLE_PROVENANCE.includes(member.provenance),
      )
      if (unlabelable.length) {
        throw new SplitIntegrityError(
          `train collection "${collectionId}" contains ${unlabelable.length} sample(s) that are not labelable: ` +
            `${unlabelable.map((member) => `${member.pieceId}(${member.provenance})`).join(', ')}. ` +
            'A model cannot learn from its own output or from an unlabelled score.',
        )
      }
    }

    for (const member of members) {
      records.push({
        sampleId: member.sampleId ?? `${collectionId}/${member.pieceId}`,
        collectionId,
        collectionAssumed: collectionIsAssumed(member.pieceId),
        pieceId: member.pieceId,
        publisherId: member.publisherId ?? null,
        instrumentId: member.instrumentId ?? 'guitar',
        provenance: member.provenance,
        labelable: LABELABLE_PROVENANCE.includes(member.provenance),
        forcedSplit: forced,
        scorable: member.scorable !== false,
        pdfPath: member.pdfPath ?? null,
        truthPath: member.truthPath ?? null,
        truthDigest: member.truthDigest ?? null,
        fileDigest: member.fileDigest ?? null,
        pixelDigests: member.pixelDigests ?? [],
        split,
        validationRole,
        pageCount: member.pageCount ?? null,
        labelCounts: member.labelCounts ?? null,
      })
    }
  }

  records.sort((left, right) => left.sampleId.localeCompare(right.sampleId))

  return {
    version: SPLIT_MANIFEST_VERSION,
    seed,
    ratios,
    collections: byCollection.size,
    samples: records,
    digest: sha256(records.map((record) => `${record.sampleId}:${record.split}:${record.validationRole}`).join('\n')),
  }
}

export class SplitIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SplitIntegrityError'
  }
}

/**
 * Every way this manifest can be wrong, checked in one place.
 *
 * All of these are hard failures. A split that leaks is worse than no split,
 * because it produces a confident number that is wrong.
 */
export function auditSplitManifest(manifest) {
  const violations = []

  // 1. A collection must not straddle a split.
  const collectionSplits = new Map()
  for (const record of manifest.samples) {
    if (!collectionSplits.has(record.collectionId)) {
      collectionSplits.set(record.collectionId, new Set())
    }
    collectionSplits.get(record.collectionId).add(record.split)
  }
  for (const [collectionId, splits] of collectionSplits) {
    if (splits.size > 1) {
      violations.push({
        rule: 'collection-straddles-split',
        collectionId,
        detail: `collection "${collectionId}" appears in ${[...splits].join(', ')}`,
      })
    }
  }

  // 2. A truth digest must not appear in two splits.
  violations.push(...crossSplitCollision(manifest, 'truthDigest', 'truth-digest-crosses-split'))

  // 3. A page pixel digest must not appear in two splits.
  const pixelOwners = new Map()
  for (const record of manifest.samples) {
    for (const digest of record.pixelDigests ?? []) {
      if (!digest) continue
      if (!pixelOwners.has(digest)) pixelOwners.set(digest, [])
      pixelOwners.get(digest).push(record)
    }
  }
  for (const [digest, owners] of pixelOwners) {
    const splits = new Set(owners.map((owner) => owner.split))
    if (splits.size > 1) {
      violations.push({
        rule: 'pixel-digest-crosses-split',
        digest,
        detail:
          `page pixels ${digest.slice(0, 12)} appear in ` +
          `${owners.map((owner) => `${owner.pieceId}(${owner.split})`).join(', ')}`,
      })
    }
  }

  // 4. A file digest must not appear in two splits.
  violations.push(...crossSplitCollision(manifest, 'fileDigest', 'file-digest-crosses-split'))

  // 5. Validation must have all three roles represented, or the roles are not
  //    independent and the separation is theatre.
  const roles = new Set(
    manifest.samples.filter((record) => record.split === SPLITS.VALIDATION).map((record) => record.validationRole),
  )
  for (const role of Object.values(VALIDATION_ROLES)) {
    if (!roles.has(role)) {
      violations.push({
        rule: 'validation-role-empty',
        detail: `validation has no "${role}" collection; temperature fitting or risk reporting would silently reuse selection data`,
      })
    }
  }

  // 6. Sealed splits must carry no validation role, so they cannot be mistaken
  //    for a selection source.
  for (const record of manifest.samples) {
    if (SEALED_SPLITS.includes(record.split) && record.validationRole) {
      violations.push({
        rule: 'sealed-split-has-validation-role',
        sampleId: record.sampleId,
        detail: `${record.pieceId} is ${record.split} but carries validationRole=${record.validationRole}`,
      })
    }
  }

  // 7. Nothing in a sealed split may be labelable-but-unlabelled-by-provenance
  //    in a training set: train must not contain generated or unlabelled samples.
  for (const record of manifest.samples) {
    if (record.split === SPLITS.TRAIN && !record.labelable) {
      violations.push({
        rule: 'train-contains-unlabelable',
        sampleId: record.sampleId,
        detail: `${record.pieceId} (${record.provenance}) is in train but is not labelable`,
      })
    }
  }

  // 8. A sample with no authoritative truth cannot produce a metric, so it must
  //    not sit in a split anyone would score on. It belongs in held-out where it
  //    can exercise the input-quality gate and be inspected by hand.
  for (const record of manifest.samples) {
    if (record.scorable === false && record.split !== SPLITS.HELDOUT) {
      violations.push({
        rule: 'unscorable-sample-outside-heldout',
        sampleId: record.sampleId,
        detail:
          `${record.pieceId} (${record.provenance}) cannot be scored but is in ` +
          `${record.split}; it must be held out`,
      })
    }
  }

  // 9. A forced split is a policy decision and must be visible, not silent.
  for (const record of manifest.samples) {
    if (record.forcedSplit && record.forcedSplit !== record.split) {
      violations.push({
        rule: 'forced-split-not-honoured',
        sampleId: record.sampleId,
        detail: `${record.pieceId} was forced to ${record.forcedSplit} but landed in ${record.split}`,
      })
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    checkedSamples: manifest.samples.length,
    checkedCollections: manifest.collections ?? collectionSplits.size,
  }
}

function crossSplitCollision(manifest, field, rule) {
  const owners = new Map()
  for (const record of manifest.samples) {
    const value = record[field]
    if (!value) continue
    if (!owners.has(value)) owners.set(value, [])
    owners.get(value).push(record)
  }
  const violations = []
  for (const [value, records] of owners) {
    const splits = new Set(records.map((record) => record.split))
    if (splits.size > 1) {
      violations.push({
        rule,
        value,
        detail: `${field} ${String(value).slice(0, 12)} appears in ${records.map((record) => `${record.pieceId}(${record.split})`).join(', ')}`,
      })
    }
  }
  return violations
}

/**
 * Build the set of samples a model may be selected on.
 *
 * Throws rather than filtering, so a caller cannot quietly receive a smaller set
 * than it asked for and proceed as if it were complete.
 */
export function assertUsableForSelection(manifest, { requireValidationRole = VALIDATION_ROLES.SELECTION } = {}) {
  const sealed = manifest.samples.filter(
    (record) => SEALED_SPLITS.includes(record.split) && record.split === SPLITS.HELDOUT,
  )
  const selection = manifest.samples.filter((record) => {
    if (record.split === SPLITS.TRAIN) return true
    if (record.split !== SPLITS.VALIDATION) return false
    return requireValidationRole == null || record.validationRole === requireValidationRole
  })

  const leaked = selection.filter((record) => SEALED_SPLITS.includes(record.split))
  if (leaked.length) {
    throw new SplitIntegrityError(
      `selection set contains ${leaked.length} sealed sample(s): ${leaked.map((r) => r.pieceId).join(', ')}`,
    )
  }
  if (!selection.some((record) => record.split === SPLITS.VALIDATION)) {
    throw new SplitIntegrityError(
      `no validation collection with role "${requireValidationRole}" is available for selection`,
    )
  }
  if (sealed.length && selection.some((record) => record.collectionId === sealed[0].collectionId)) {
    throw new SplitIntegrityError('held-out collection also appears in the selection set')
  }
  return selection
}

/** Held-out samples, for use only after a candidate has been selected. */
export function heldOutSamples(manifest) {
  return manifest.samples.filter((record) => record.split === SPLITS.HELDOUT)
}

/**
 * Minimum corpus size for a structurally valid manifest.
 *
 * A manifest needs at least one collection per split, and validation needs one
 * collection for each of its three independent roles. Anything smaller cannot
 * satisfy the contract no matter which seed is chosen, so the shortfall is
 * reported as a quantity to fix rather than hidden by picking a lucky seed.
 */
export function corpusSufficiency(manifest) {
  const collections = new Set(manifest.samples.map((record) => record.collectionId))
  const bySplit = new Map()
  for (const record of manifest.samples) {
    if (!bySplit.has(record.split)) bySplit.set(record.split, new Set())
    bySplit.get(record.split).add(record.collectionId)
  }
  const validationRoles = new Set(
    manifest.samples
      .filter((record) => record.split === SPLITS.VALIDATION)
      .map((record) => record.validationRole)
      .filter(Boolean),
  )

  const required = {
    [SPLITS.TRAIN]: 1,
    [SPLITS.VALIDATION]: Object.keys(VALIDATION_ROLES).length,
    [SPLITS.HELDOUT]: 1,
    [SPLITS.DIAGNOSTIC]: 1,
  }
  const shortages = []
  for (const [split, needed] of Object.entries(required)) {
    const have = bySplit.get(split)?.size ?? 0
    if (have < needed) {
      shortages.push({ split, have, needed, shortBy: needed - have })
    }
  }
  const labelableCollections = new Set(
    manifest.samples.filter((record) => record.labelable).map((record) => record.collectionId),
  ).size

  return {
    totalCollections: collections.size,
    labelableCollections,
    minimumCollections: Object.values(required).reduce((sum, value) => sum + value, 0),
    validationRolesPresent: validationRoles.size,
    validationRolesRequired: Object.keys(VALIDATION_ROLES).length,
    shortages,
    sufficient: shortages.length === 0,
  }
}

/**
 * Seeds, in order, whose manifest satisfies every structural rule.
 *
 * The seed is chosen to satisfy a structural constraint, not to produce a
 * flattering result — the split carries no measurements. Reporting how many
 * seeds were tried and how many passed is what makes that auditable: a corpus
 * where only one seed in a thousand works is a corpus that is one acquisition
 * away from being unusable, and that must be visible.
 */
export function findValidSeeds({ samples, seedCount = 2000, seedBase = 1, ratios, validationFractions }) {
  const valid = []
  const failures = new Map()
  for (let offset = 0; offset < seedCount; offset += 1) {
    const seed = seedBase + offset
    let manifest
    try {
      manifest = buildSplitManifest({ samples, seed, ratios, validationFractions })
    } catch (error) {
      failures.set(error.name ?? 'Error', (failures.get(error.name ?? 'Error') ?? 0) + 1)
      continue
    }
    const audit = auditSplitManifest(manifest)
    const sufficiency = corpusSufficiency(manifest)
    if (audit.ok && sufficiency.sufficient) {
      valid.push(seed)
    } else {
      for (const violation of audit.violations) {
        failures.set(violation.rule, (failures.get(violation.rule) ?? 0) + 1)
      }
    }
  }
  return {
    seedsTried: seedCount,
    validSeeds: valid,
    validCount: valid.length,
    failureHistogram: Object.fromEntries([...failures.entries()].sort((a, b) => b[1] - a[1])),
  }
}

/** Verify a manifest has not drifted from a frozen digest. */
export function assertManifestUnchanged(manifest, expectedDigest) {
  if (manifest.digest !== expectedDigest) {
    throw new SplitIntegrityError(
      `split manifest digest changed: expected ${expectedDigest}, got ${manifest.digest}. ` +
        'A frozen split may not be regenerated with a different outcome.',
    )
  }
  return true
}
