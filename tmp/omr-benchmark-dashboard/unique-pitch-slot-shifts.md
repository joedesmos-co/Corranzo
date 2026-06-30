# Unique-pitch rhythm slot shift analysis

**Baseline:** dense fixture post staff-gap normalization (wrongOnset 94)  
**Scope:** 13 independent onset errors where truth label appears once in the measure  
**Code changes:** None (no safe discriminator found)

---

## Executive summary

After replaying OMR events and comparing x position → snap16 → assigned onset:

| Category | Count | OMR fixable without evaluator? |
|----------|------:|------------------------------|
| Matcher picks wrong instance (gen **has** correct slot) | **5** | No |
| True missing / wrong-x slot | **5** | Partially (needs bounds work) |
| Near slot (snap matches x, wrong column in figure) | **3** | No |

**There is no single safe discriminator that fixes only the true rhythm slot shifts.** Tested candidates regressed or had no benchmark effect.

---

## Extraction (13 cases)

| m | label | truth@ | gen@ | Δ div | page |
|--:|-------|-------:|-----:|------:|-----:|
| 5 | D2 | 2.75 | 2.0 | −3 | 1 |
| 8 | D#3 | 1.5 | 1.0 | −2 | 1 |
| 9 | B1 | 1.5 | 2.25 | +3 | 1 |
| 9 | F#2 | 1.5 | 2.25 | +3 | 1 |
| 9 | B2 | 1.5 | 2.25 | +3 | 1 |
| 9 | C2 | 2.0 | 2.5 | +2 | 1 |
| 9 | G2 | 2.0 | 2.5 | +2 | 1 |
| 55 | C6 | 0 | 0.5 | +2 | 4 |
| 121 | B1 | 1.5 | 0.75 | −3 | 8 |
| 121 | C2 | 2.0 | 1.25 | −3 | 8 |
| 122 | D#2 | 1.5 | 1.0 | −2 | 8 |
| 125 | G1 | 1.0 | 1.75 | +3 | 8 |
| 125 | G2 | 1.0 | 1.75 | +3 | 8 |

---

## Classification (OMR event replay)

### A. Matcher picks wrong instance — **5 cases** (ignore per task)

OMR **already emits** an event at the expected division; evaluator links truth to a different repeated instance.

| m | label | expected div | gen instances at expected div |
|--:|-------|-------------:|------------------------------:|
| 8 | D#3 | 6 | **1** (also at div 4) |
| 9 | B1 | 6 | **1** (7 instances total) |
| 9 | F#2 | 6 | **1** (6 instances) |
| 9 | B2 | 6 | **1** (9 instances) |
| 121 | B1 | 6 | **1** (5 instances) |

Example m9 B1: event at **startQ=1.5** (div 6) exists at pos 0.394; matcher pairs truth@1.5 → gen@2.25.

**Not fixable in OMR without changing evaluator or deduplicating repeated figure instances globally.**

### B. True missing / wrong slot — **5 cases**

| m | label | x/pos | snap16 (box) | snap16 (playable) | expected | issue |
|--:|-------|------:|-------------:|------------------:|---------:|-------|
| 5 | D2 | pos 0.650 | **10** | **11** | 11 | barline box denominator; playable span fixes snap |
| 55 | C6 | pos 0.098 | 2 | 1 | 0 | opening column; not first group |
| 121 | C2 | — | — | — | 8 | no instance near beat 2 |
| 122 | D#2 | — | — | — | 6 | no instance at beat 1.5 |
| 125 | G1 | — | — | — | 4 | no G1 detected in measure |

### C. Near slot — **3 cases**

Assigned onset **equals snap16**; notehead x maps to a later column in a repeated arpeggio figure.

| m | label | pos | snap16 | expected | assigned |
|--:|-------|----:|-------:|---------:|---------:|
| 9 | C2 | 0.641 | 10 | 8 | 2.5q |
| 9 | G2 | 0.641 | 10 | 8 | 2.5q |
| 125 | G2 | 0.285 | 5 | 4 | 1.25q |

These are **wrong figure iteration** at correct pitch, not snap-phase slip (`assignedEqSnap16=true` for all).

---

## Why notes snap late (root cause by category)

| Hypothesis | Applies to | Verdict |
|------------|------------|---------|
| Eighth vs sixteenth cluster snap | — | **Ruled out** — assigned == snap16; cluster snap change had **zero** benchmark effect |
| Beat grid phase offset | B only (m5) | **Partial** — box pos compresses late by ~1 sixteenth |
| Opening column (first-group-only) | m55 | **Identified** but extending to all groups **regressed** (+7 wrongOnset, +52 chord) |
| Playable-span rhythm position | m5 | **Would fix** m5 D2; requires rhythm denominator change (user: no measure grid without proof) |
| Matcher instance coupling | A (5 cases) | **Confirmed** — not OMR rhythm |
| Repeated-figure wrong column | C (3 cases) | **Confirmed** — x genuinely at 2.25/2.5 column |

---

## Tested fix candidates

| candidate | unique-pitch benefit | dense benchmark | tests |
|-----------|---------------------|-----------------|-------|
| Sixteenth cluster snap (line 1724) | 0 | wrongOnset unchanged 94 | pass |
| Opening column for all groups | m55 C6 only | **94→101**, chord **239→291** | **1 fail** |
| Playable-span position (not implemented) | m5 D2 only | unknown | — |

---

## Decision: no implementation

Per task rules:
- No evaluator changes
- No safe discriminator that fixes **only** true rhythm slot shifts
- Broadening opening alignment **regresses** chord/onset
- Playable-span rhythm position is the one proven fix for m5 but touches position normalization broadly

**Recommended next steps (future pass):**
1. Playable-span rhythm position for `denseMeasure && usePositionStarts` with benchmark gate (may help m5 + others; not unique-pitch-only)
2. Do not dedupe repeated figure instances without chord regression tests
3. Treat 5/13 “unique pitch” cases as matcher-visible-only until evaluator changes are allowed

---

## Artifacts

- `unique-pitch-classification.json` — matcher vs missing vs near
- `unique-pitch-playable-span.json` — box vs playable snap comparison
- `unique-pitch-slot-analysis.json` — event replay details
