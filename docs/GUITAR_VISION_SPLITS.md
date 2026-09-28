# Guitar Vision — Frozen Splits and Provenance

**Status:** frozen. `guitar-splits/1.0`
**Manifest:** `datasets/guitar-vision/splits/frozen.json`
**Rebuild:** `node tools/guitar-vision/build-split-manifest.mjs --out datasets/guitar-vision/splits/frozen.json --seed-search 400`
**Modules:** `src/features/omr/guitar/corpusSplits.js`, `provenance.js`

Current manifest: seed **24**, digest `51e77dfaccbd4f84…`, audit **CLEAN**.

---

## The leakage risk this addresses

The real guitar corpus is 13 Mutopia scores, and they are **not independent**:

- six of them (`aguado-op03-1` … `op03-6`) are consecutive studies from **one
  collection**, sharing an engraver, font, measure widths and beam styles;
- three more (`bach-prelude-bwv997`, `bach-prelude-bwv999`,
  `bach-menuet-bwv1006a`) come from **the same Lute Suite edition**.

Splitting per score would put siblings on both sides of the split and yield a
validation number that measures memorisation of an engraving style. Splitting is
therefore by **collection**, and a straddling collection is a hard failure
(`collection-straddles-split`).

---

## The three separations

**1. Split** — `train` / `validation` / `heldout` / `diagnostic`, assigned by a
stable SHA-256 hash of the collection id. Deterministic across processes and
machines: no clock, no RNG, no insertion order.

**2. Validation role** — validation is partitioned into `selection`,
`temperature` and `risk` by a second independent hash. Fitting confidence
temperature on checkpoint-selection data, or estimating risk on it, both bias the
number that is supposed to be trustworthy. The audit fails if any role is empty,
because an empty role means the separation is theatre.

**3. Identity** — every sample is fingerprinted twice:

| digest | catches |
|---|---|
| `truthDigest` — canonicalised musical content (notes, pitch, onsets, durations, string/fret, dots), order-independent | a resaved or reformatted copy of the same score |
| `pixelDigest` — SHA-256 of rendered grayscale page pixels | the same page re-encoded at a different DPI, or saved under another name |
| `fileDigest` — SHA-256 of the PDF bytes | a byte-identical duplicate |

Truth digests ignore byte formatting but *do* change when a pitch, fret, onset
or time signature changes. Pixel digests tolerate colour-space changes that
preserve luma, so a re-saved page is not mistaken for new content.

---

## Provenance: 129 outputs that must never be labels

The repository tracks ~670 `.musicxml` files under `tmp/`. They are **OMR engine
output** from past experiments, named indistinguishably from truth. 144 of them
carry no OMR marker at all, so a content-only policy would misclassify them.
Classification is layered strongest-first, and every decision records which rule
fired:

| rule | behaviour |
|---|---|
| `declared-manifest` | trust the human assertion in the manifest (highest) |
| `scratch-path-policy` | anything in `tmp/` and friends is machine output **by policy**, content irrelevant |
| `content-signal` | OMR disclaimer, `sfnh-` engine note ids, `.omr.` suffix, shadow-IR name, experiment directory |
| `fragment-path` | an extracted snippet, never a whole score |
| `unrecognised` | **`unlabelled`, never `real-printed`** |

That last row is the important one. Defaulting an unknown file to "real" is
precisely the inversion that caused the original problem. Ambiguity is surfaced
for human review rather than guessed at.

Current classification of the 24 discovered sources:

```
real-printed  14    synthetic-cc0  5    unlabelled  5    labelable  19
```

---

## The frozen split

```
split        samples  collections  notes
train           14          7        all scorable
validation       3          3        one per role (selection / temperature / risk)
heldout          6          6        1 scorable, 5 real PDFs with no truth
diagnostic       1          1        scorable
```

34 pages fingerprinted, 19 truth digests, **0 pixel-digest collisions across
splits**, audit clean.

---

## Two weaknesses that must not be glossed over

**1. The scorable held-out set is one score.** `guitar-ode-to-joy` is the only
scored held-out sample. Five of the six held-out entries are real guitar TAB PDFs
that were deliberately parked with **no ground truth** — `canon-in-d`,
`gravity-falls`, `home-undertale-ost-012`, `pirates-of-the-caribbean`,
`save-me-bts`. They are the most representative real-world guitar TAB in the
repository and they cannot be trained on or scored on.

A one-score held-out set cannot support any statistical claim. No Clopper-Pearson
bound is meaningful at n=1, and no "usable score rate" can be stated.

**2. The corpus only just satisfies the contract.** With 12 labelable
collections, only **17 of 400 seeds (4.3%)** produce a structurally valid split.
That is reported explicitly, and a marginal corpus is one acquisition away from
being unusable. The minimum for a valid four-way split with three independent
validation roles is 6 collections; we have 12, but the hash distribution makes a
valid draw unlikely.

There is also an awkward bind: `guitar-ode-to-joy` is simultaneously the **only
paired notation+TAB ground truth in the repository**. Holding it out means the
model can never learn paired staff/TAB notation from real data; training on it
means there is no held-out paired case. This needs resolving by acquiring a
second paired score, and is called out in the acquisition plan.

---

## Guards, all hard failures

- `collection-straddles-split`
- `truth-digest-crosses-split`, `pixel-digest-crosses-split`, `file-digest-crosses-split`
- `validation-role-empty`
- `sealed-split-has-validation-role`
- `train-contains-unlabelable`
- `unscorable-sample-outside-heldout`
- `forced-split-not-honoured`

`assertUsableForSelection` **throws** rather than filtering, so a caller cannot
quietly receive a smaller set than it asked for and proceed as if it were
complete. A sample with no truth is *forced* to held-out before the hash runs —
relocating it afterwards is how an unlabelled PDF would reach training.

`assertManifestUnchanged` pins the manifest digest, so a "frozen" split cannot be
regenerated into something different.
