# Stage M — measure identity map (M0–M13)

Corpus 2.1 unchanged. No manual labels. No RTX, no training, no model work.
Corpus 2.2 and the zero-parameter baseline were **not** built: the clean gate did
not pass and N is too small to certify.

## Why this stage exists

Stage C failed at 0.3646 because intervals were paired by normalised x inside the
staff. A wrong measure could coincide with the right onset count and masquerade as
a structurally complete match. The blocker is **measure identity**, so this stage
fixes measure identity first, from structure only.

## M0 — MusicXML structural fingerprint (document order)

Per measure, both parts merged by ordinal: ordinal, printed `number`, `implicit`,
engraving `width`, summed `duration`, onset/note/rest/chord counts, left and right
barline with `repeat` and `bar-style`, and key/time/clef change markers. Duration
and onset counts are rhythmic, so they are strong discriminators that never touch
pitch. Every score has 2 parts with equal measure counts, so the ordinal sequence
is unambiguous.

## M1 — PDF printed interval fingerprint (reading order)

`page → system → interval`, left to right, from the **unchanged** validated
cross-staff barline matcher. Per interval: boundary x, both boundary barline widths
and coverages, system extent, staff gap.

Intervals must be bounded by **internal paired boundaries only**. The two staff-edge
regions hold the clef and the system terminator, not measures; including them
inflated the count from the validated 774 to 1332.

## M2–M6 — anchors, alignment, anti-slide

| Anchor | Fires when | Count |
|---|---|---|
| `A_START` | first printed interval ↔ first MusicXML measure | 15/15 scores |
| `A_END_FINAL_BAR` | last printed interval closed by a barline ≥ 4× the score's median barline width (a printed barline is a thin 2 px stroke; a double/final bar is 11–19 px) | 9/15 scores |
| count anchor | printed intervals == measures and ordinal 0 pinned ⇒ identity is the only monotone bijection | 1/15 scores |

Alignment is Needleman–Wunsch with explicit insert/delete ops, each recorded with
its region, PDF ordinal, XML ordinal and a structural reason. **3** edit operations
were recorded corpus-wide. The M6 anti-slide test counts optimal alignments: where
more than one alignment shares the minimal cost, every measure in that region is
marked `AMBIGUOUS` rather than chosen.

Confidence is structural only. No delta, residual or decoder result was consulted.

## M8 — map-only sanity, no notes inspected

774 printed intervals vs 931 MusicXML measures. Printed-interval minus measure
count, per score:

```
etude-12 -50   beethoven -47   etude-01 -36   tchaikovsky -14   fur-elise -6
prelude -5   minuet -3   turkish -1   dense-advanced 0   handel +1
mazurka +6   grand-voices +6   fugue +5   mozart +12   nocturne +16
```

Four of the large negatives are page-truncated PDFs, which legitimately have fewer
printed measures. The complete scores still disagree by −14…+16, so the printed
barline detector both over- and under-detects where truncation cannot explain it.

| Class | Count |
|---|---|
| `EXACT_ANCHORED` | 23 |
| `HIGH_CONFIDENCE_COUNT_ANCHORED` | 7 |
| `AMBIGUOUS` | 698 |
| `UNMAPPED` | 46 |

Frozen: `out/M7_measure_map.json`, 774 entries,
`sha256 7bbfe2484260074234f98623ff9a277a2182b7b5d9c1299083e53b375b879a5b`.

## M9 — subset on the frozen map

Because a mapped measure now carries a MusicXML ordinal, the Verovio side is reached
by **measure ordinal in document order**. No staff-system alignment, no pagination,
no x-fraction matching — which removes the Stage C contamination mechanism.

```
onset groups seen / structurally complete : 8 / 2
frozen note pairs                        : 22
sha256 4e30b08add43d7514cc24ed5a42355dcbdf2fe16e331f8fd4b89884bb0a73ff1
```

## M10 — clean control

```
clean N              : 20
median delta_space   : +0.0311
p10 / p90            : -0.0081 / +0.0494
|delta_space| < 0.25 : 0.9000   (need > 0.98)
r_render == 0        : 0.9000   (need > 0.98)
GATE                 : FAIL
```

**The method is validated.** The clean rate rose from 0.3646 to 0.9000 purely by
fixing measure identity, and 18 of 20 clean notes fall within ±0.055 staff spaces.
Both failures are one diatonic step (Δ = −0.45, +0.54), both in
`bc-bach-fugue-bwv846` measure 0, upper staff, onset groups 4 and 5.

The gate still fails because N = 20 cannot certify a >98% threshold, not because
the residual is bad.

## M13 — exact label shortfall

| Score | Cause | Count |
|---|---|---|
| omf-piano-dense-advanced-vector | no corpus system for this staff | 8 |
| bc-bach-fugue-bwv846 | corpus labels fewer than rendered | 4 |
| bc-chopin-etude-op10-12 | corpus labels fewer than rendered | 2 |
| bc-bach-fugue-bwv846 | role has no corpus labels | 1 |
| bc-chopin-etude-op10-01 / bc-mozart-k153 / pl-chopin-mazurka-op6-1 / pl-tchaikovsky-old-french-song | no corpus system for this staff | 1 each |
| omf-piano-grand-voices-vector / pl-beethoven-fur-elise | role has no corpus labels | 1 each |
| pl-handel-gavotte / std-demo-minuet-in-g | corpus labels fewer than rendered | 1 each |

## Bottleneck

The printed-barline detector, not the geometry and not note matching. Its interval
count disagrees with the MusicXML measure count by up to ±16 on complete scores,
which leaves only 30 of 774 intervals anchored or high-confidence and starves M9.
