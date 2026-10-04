# Stage AI — AI_BLIND_CONSENSUS: STOPPED at A3, independence not technically possible

**NOT human ground truth. NOT manually certified.** Nothing in this stage produced a
correspondence set, because no reviewer ran.

## What was completed

**A0 — packet verified (no regeneration, no selection change).**
- 80 review items, manifest sha256 `56946306935e698825b46cc8ee3d53f5...` unchanged.
- All 80 contact sheets present.
- Hidden-field audit on the manifest **items**: no occurrence of `residual`,
  `true_d`, `d0`, `decoder`, `mismatch` or `midi`. The only hits in the file are in
  the top-level prose disclaimer, which names the fields in order to declare their
  absence.

**A1 — reviewer-only neutral inputs created.**
- `out/h_review_ai/inputs/R001.png … R080.png` — byte copies under neutral names.
  The original sheets embed the score name in the *filename*, which would let a
  reviewer recognise the piece, so neutral aliases are mandatory, not cosmetic.
- `out/h_review_ai/items_neutral.json` — item id, image path, `P` ids, `X` ids only.
  No score, page, system, mapping class, Category A/B membership or coverage count.
- `items_neutral.sha256` = `eb298a329590d37afe22b60a7ef881d7...`
- Split into 4 batches of 20 for isolated review.

**A2 — rubric written** (`out/h_review_ai/rubric.md`): A/B/C/D/E plus the second-pass
vertical-rank mapping `P1a→X1a`, with explicit conservative-`UNSURE` instructions
and the rule that a printed onset missing from the proposals is recorded as an
unlisted visible onset rather than ignored.

**A5–A9 machinery written and verified to refuse** (`h_ai_consensus.py`): schema and
id validation, P/X reference validation, second-pass internal-validity checks,
per-item and pairwise agreement metrics, the full A6 conservative consensus rules,
and manifest hashing. Run with no reviewer files it exits 2 with
`REFUSING TO PROCEED`.

## A3 — the blocker

Three independent fresh blinded visual contexts are **not technically available**.

- The only subagent mechanism available to this session returns
  `Subagent depth limit reached (0)`.
- Cause: `~/.config/opencode/opencode.jsonc` sets `"subagent_depth": 0`.
- That is a **global** config shared with the concurrently running Guitar, Roblox
  and Godot sessions, so it was not edited unilaterally.

A3 explicitly forbids simulating independence by re-asking one context, so no
reviewer pass was fabricated.

### Why this session cannot substitute as a reviewer

Beyond the independence rule, this context is **contaminated** for this packet. I
built it, and for these exact 80 items I have already seen the mapping classes, the
Category A/B split, the per-measure missing and ambiguous notehead counts, and the
earlier clean-residual diagnostics. Any judgement I made here would not be blind, so
it would be worse than no reviewer at all — it would look like evidence while
carrying prior knowledge of the answer.

## What is needed to unblock

1. Raise `subagent_depth` to ≥1 in `~/.config/opencode/opencode.jsonc` (user action;
   it affects all concurrent sessions), or
2. Run the three passes as three separate top-level opencode sessions, each pointed
   at `out/h_review_ai/` with the rubric and one batch, or
3. Have the user perform the adjudication in `review.html` (already built, 80 items).

Once any of those exist, `h_ai_consensus.py` runs unchanged and produces
`ai_blind_consensus_manifest.json` plus its hash, still **before** any residual join.

## Resource note

Swap rose from 2.9 GB to 7.4 GB during this stage, driven by the other concurrent
agents, not by this work (which is serial and light). Flagged as
**RESOURCE_PAUSE risk** for any future heavy pass.
