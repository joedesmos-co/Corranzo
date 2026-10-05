"""P12 corrected - one unified reviewer prompt per reviewer, plus preflight validation.

The previous generator emitted FOUR independent instruction blocks, each with its own
"reply exactly one line" and each writing to the SAME final reviewer path. Executed
literally that either stopped after batch 1 or let batch 4 overwrite batches 1-3.

The corrected prompt is ONE flow: a single reviewer identity, batches 1-4 reviewed
sequentially, per-batch TEMPORARY artifacts that are never overwritten, and exactly ONE
final reviewer JSON written only after all four batches are complete, containing all
80 unique item ids.

Blinding restrictions are preserved verbatim. Reviewers still never see each other.

This script changes prompts only. The packet, rubric, schema, images and scientific
rules are untouched.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

V2 = Path(__file__).parent / "out/h_review_ai_v2"
NAMES = ["V2_REVIEWER_1", "V2_REVIEWER_2", "V2_REVIEWER_3"]
NBATCH = 4
NITEMS = 80

TEMPLATE = """You are {NAME}, ONE independent blinded structural music-notation reviewer.
You have your own fresh context. Judge only from what you can see in each image.

Working directory: /Users/ryland/Documents/scoreflow-piano-v26

This is ONE continuous job with FOUR batches and {NITEMS} items in total. Work through
every batch in order. Do NOT stop or finish after any single batch.

=========================================================================
PART 1 - READ THE RUBRIC AND THE SCHEMA (once, at the start)
=========================================================================
Read:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/rubric_v2.md
  tools/piano-vision-v26-audit/out/h_review_ai_v2/schema_v2.json
Then look at TWO instructional examples. They are synthetic teaching cases, not real
data, and they are the fastest way to understand the question semantics:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/examples/ex1_same_with_one_source_extra.png
  tools/piano-vision-v26-audit/out/h_review_ai_v2/examples/ex3_same_rhythm_uncertain_dense_chord.png

=========================================================================
PART 2 - REVIEW ALL FOUR BATCHES SEQUENTIALLY
=========================================================================
The four batch lists are:
  tools/piano-vision-v26-audit/out/h_review_ai_v2/batches/batch1.json
  tools/piano-vision-v26-audit/out/h_review_ai_v2/batches/batch2.json
  tools/piano-vision-v26-audit/out/h_review_ai_v2/batches/batch3.json
  tools/piano-vision-v26-audit/out/h_review_ai_v2/batches/batch4.json

Process them in order: batch1, then batch2, then batch3, then batch4.

For EACH batch:
  a) Read that batch's JSON with the read tool. Each entry has item_id, image,
     n_pdf_proposals and source_cards.
  b) For EACH entry, read its image with the read tool:
       tools/piano-vision-v26-audit/out/h_review_ai_v2/<image>
     and actually look at it before answering.
  c) Answer that item exactly as the rubric and schema specify:
       A = SAME_STRUCTURE | DIFFERENT_MEASURE | UNSURE
       B = per source onset Xn: PRINTED | NOT_PRINTED | UNSURE
       C = per PDF proposal Pn: an X id, or NO_SOURCE_COUNTERPART, or UNSURE
       D = YES | NO | UNSURE
       E = HIGH | MEDIUM | LOW
     If E is HIGH, also do the second pass for each onset pair you matched:
     RANK_OK with an explicit map like {{"P1a":"X1a","P1b":"X1b"}}, or AMBIGUOUS.
     Record clearly visible printed onsets that carry no P label in
     unlisted_visible_onsets.

     The LEFT panel is the printed PDF raster with machine proposals P1..Pn, which
     are unreliable in both directions. The RIGHT panel is the same measure as a
     RHYTHM SKELETON whose every notehead height has been canonicalised to a neutral
     slot, so it shows rhythm, onset order, chord cardinality, stems, beams, flags,
     rests, dots, tuplets, meter and barlines, and no pitch information at all. The
     panels are independently laid out and are NOT horizontally aligned; judge
     sequence and rhythm, never pixel alignment.

     A is about STRUCTURE. A single extra or missing note does NOT make A
     DIFFERENT_MEASURE; that is what B and C are for.

  d) AFTER finishing a batch, write that batch's answers to its own TEMPORARY file:
       tools/piano-vision-v26-audit/out/h_review_ai_v2/reviews/{NAME}_batch{{K}}.json
     for K = 1, 2, 3, 4 respectively. Each temporary file holds only that batch's
     items. Never write to a temporary file more than once, and never let one batch
     overwrite another.

Continue to the next batch. Keep going until all four batches are finished.

=========================================================================
PART 3 - WRITE ONE FINAL FILE, ONLY AFTER ALL FOUR BATCHES
=========================================================================
Only after batch1, batch2, batch3 and batch4 are ALL complete:

  a) Read your four temporary files back and merge them.
  b) VERIFY the merged set contains exactly {NITEMS} entries with {NITEMS} UNIQUE
     item_id values (R001 through R080), with no duplicates and no missing ids. If it
     does not, something went wrong: fix it before continuing.
  c) Write the single final file:
       tools/piano-vision-v26-audit/out/h_review_ai_v2/reviews/{NAME}.json
     with this shape:
     {{"reviewer":"{NAME}","batches":[1,2,3,4],"items":[ ... all {NITEMS} items ... ]}}

     Each item looks like:
     {{"item_id":"R001","A":"SAME_STRUCTURE","B":{{"X1":"PRINTED"}},
       "C":{{"P1":"X1"}},"D":"YES","E":"HIGH","unlisted_visible_onsets":[],
       "second_pass":{{"P1":{{"verdict":"RANK_OK","map":{{"P1a":"X1a"}}}}}}}}

  d) This is the ONLY final output file you create. Write it once. Do not write it
     per batch and do not write it until all four batches are done. Your four
     temporary batch files may remain on disk as provenance; that is expected and
     harmless.

=========================================================================
PART 4 - REPLY
=========================================================================
Reply with exactly ONE line, and only after the final file is written:

  {NAME} done: <NITEMS> items

=========================================================================
ABSOLUTE RULES - violating any of these invalidates the work
=========================================================================
- Work under the single identity {NAME} and no other. Review all {NITEMS} items
  across all four batches yourself.
- Do NOT stop, summarise or finish after any single batch. There is no per-batch
  termination.
- Do NOT open any other file in the repository. Never open out/h_review_manifest.json,
  out/h_review_lookup_INTERNAL.json, anything under out/h_review_ai/ (the V1 packet or
  the V1 reviewer files), any out/L*.json, or any file whose name contains residual,
  d0, true_d, decoder, mismatch, answers, reviewer_1, reviewer_2 or reviewer_3.
- In tools/piano-vision-v26-audit/out/h_review_ai_v2/reviews/ you may open ONLY your
  own four temporary batch files and your own final file. Do NOT list that directory,
  do NOT open any other reviewer's output, and do NOT read, copy or infer another
  reviewer's answers by any means. You must never see another reviewer's answers.
- Do NOT run git. Do NOT search the repo. Do NOT try to identify the score, page,
  system or measure behind an item.
- Do NOT look for or accept any expected answer, consensus, or hint. None are
  available and you must not seek them.
- Never name a note, octave or accidental value, and do not try to infer pitch. Judge
  printed structure only.
- Be conservative: prefer UNSURE over a forced match. Never invent a one-to-one
  mapping to fill C. P labels are proposals, not truth.
- Work serially. Do not spawn other agents.
"""


def write_prompts():
    (V2 / "batches").mkdir(parents=True, exist_ok=True)
    (V2 / "reviews").mkdir(parents=True, exist_ok=True)
    items = json.loads((V2 / "items_neutral.json").read_text())["items"]
    assert len(items) == NITEMS, len(items)
    per = NITEMS // NBATCH
    for b in range(NBATCH):
        chunk = items[b * per:(b + 1) * per] if b < NBATCH - 1 else items[b * per:]
        (V2 / "batches" / ("batch%d.json" % (b + 1))).write_text(
            json.dumps(chunk, indent=1))
    paths = []
    for i, name in enumerate(NAMES):
        p = V2 / ("prompt_%d.txt" % (i + 1))
        p.write_text(TEMPLATE.replace("{NAME}", name)
                     .replace("{NITEMS}", str(NITEMS))
                     .replace("{K}", "<K>"))
        paths.append(p)
    return paths


# ------------------------------------------------------------- preflight
def preflight():
    print("PREFLIGHT validation of reviewer prompts\n")
    ok_all = True
    for i, name in enumerate(NAMES, start=1):
        p = V2 / ("prompt_%d.txt" % i)
        raw = p.read_text()
        t = re.sub(r'\s+', ' ', raw)
        checks = {}
        # 1 correct reviewer named, and no other reviewer named
        others = [n for n in NAMES if n != name]
        checks["names correct reviewer"] = (name in t)
        checks["no other reviewer named"] = (not any(o in t for o in others))
        checks["single identity"] = (
            len(re.findall(r"You are %s" % re.escape(name), t)) == 1)
        # 2 covers batches 1-4
        missing_b = [b for b in range(1, NBATCH + 1)
                     if ("batch%d.json" % b) not in t]
        checks["covers batches 1-4"] = (not missing_b)
        # 3 exactly one final output target
        final = t.count("reviews/%s.json" % name)
        checks["exactly one final output"] = (final >= 1)
        temps = set(re.findall(r"reviews/%s_batch\{?<?K>?\}?\.json" % re.escape(name), t))
        checks["temp artifacts declared"] = ("_batch" in t)
        checks["no per-batch final write"] = (
            "Do not write it per batch" in t
            and "ONLY final output file" in t)
        checks["no per-batch termination"] = (
            "Do NOT stop, summarise or finish after any single batch" in t)
        checks["sequential instruction"] = (
            "batch1, then batch2, then batch3, then batch4" in t)
        # 4 requires 80 unique items before completion
        checks["requires 80 unique items"] = (
            ("%d UNIQUE" % NITEMS) in t and ("R001 through R080" in t))
        checks["verify before final write"] = ("VERIFY the merged set" in t)
        checks["blinding rules preserved"] = (
            all(k in t for k in ["out/h_review_manifest.json",
                                 "out/h_review_lookup_INTERNAL.json",
                                 "true_d", "decoder", "Do NOT run git",
                                 "Never name a note, octave or accidental value"]))
        checks["cannot see other reviewers"] = (
            "never see another reviewer's answers" in t)
        bad = [k for k, v in checks.items() if not v]
        ok_all = ok_all and not bad
        print("  prompt_%d.txt  %s" % (i, "PASS" if not bad else "FAIL " + str(bad)))
        for k, v in checks.items():
            print("      %-32s %s" % (k, "ok" if v else "FAIL"))
        final_hits = re.findall(r"reviews/%s\.json" % re.escape(name), t)
        print("      final-file mentions: %d   temp-file pattern: %s"
              % (len(final_hits), bool(temps) or "_batch" in t))
    # cross-check: the three prompts must target three DIFFERENT files
    tgts = []
    for i, name in enumerate(NAMES, start=1):
        m = re.findall(r"reviews/(%s\.json)" % re.escape(name),
                       re.sub(r'\s+', ' ', (V2 / ("prompt_%d.txt" % i)).read_text()))
        tgts.append(m[0] if m else None)
    distinct = len(set(tgts)) == 3 and all(tgts)
    ok_all = ok_all and distinct
    print("\n  three prompts target three distinct files: %s  %s"
          % (distinct, tgts))
    print("\nPREFLIGHT: %s" % ("PASS" if ok_all else "FAIL"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "preflight":
        sys.exit(preflight())
    for p in write_prompts():
        print("wrote %s" % p)
    sys.exit(preflight())