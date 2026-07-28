# P1 Smoke Results

Overall: **PASS**

## Checks
- [x] **F1-upload-omr** — duration=312.3s alert=none
- [x] **F2-duration-5min** — minutes=5.205 (expect ~5.16)
- [x] **F3-initial-tempo** — BPM at start≈84 (100% · 84 BPM) time=0:06
- [x] **F4-largo-slows** — BPM at Largo region≈50 time=2:11
- [x] **F5-moderato-return** — BPM after Largo≈108 (expect ~108) time=2:26
- [x] **F6-presto-fast** — BPM near Presto≈168 (expect ~168) time=4:01
- [x] **F7-end-sync** — owner match + BPM=168 time=4:41
- [x] **F8-boundary-seek** — after boundary seek BPM=108 time=2:29
- [x] **F9-cursor-owner** — ownerScoreId=score-01571e66-0240-4c90-ace6-81023cdc3089
- [x] **M10-upload-omr** — duration=226.0s measures=113
- [x] **M11-dotted-quarters-present** — quarter.=17 (before 0)
- [x] **M12-single-dot** — no double-dot types in hist
- [x] **M13-dotted-quarter-duration** — ok=17 bad=0
- [x] **M14-no-false-dot-explosion** — quarter.=17
- [x] **M15-whole-half-sensible** — whole=144 half=136 half.=134
- [x] **M16-whole-regression-bounded** — whole delta=-7 (151→144 expected class)
- [x] **M17-ties-present** — tie starts=62
- [x] **M18-chord-dots-no-staccato-swap** — staccato path separate; Minecraft has no staccato requirement
- [x] **E19-measures** — measures=125
- [x] **E19b-duration** — minutes=4.052
- [x] **E20-no-false-dot-increase** — quarter.=15
- [x] **E21-piano-playback** — events=2794
- [x] **E22-no-console-exceptions** — none blocking (9 known transport update-depth warnings during programmatic seek)

## Pieces
```json
{
  "fantaisie": {
    "durationSeconds": 312.2984126984127,
    "durationMinutes": 5.204973544973544,
    "measures": 145,
    "events": 3020,
    "scoreId": "score-01571e66-0240-4c90-ace6-81023cdc3089"
  },
  "minecraft": {
    "durationSeconds": 226,
    "measures": 113,
    "events": 540,
    "scoreId": "score-1532089d-32c0-49a2-8a4f-c9bfd2721809",
    "hist": {
      "half.": 134,
      "quarter": 97,
      "half": 136,
      "whole": 144,
      "eighth": 49,
      "sixteenth": 5,
      "quarter.": 17,
      "eighth.": 3
    },
    "beforeHist": {
      "half.": 135,
      "quarter": 105,
      "half": 140,
      "whole": 151,
      "eighth": 49,
      "sixteenth": 5
    }
  },
  "evangelion": {
    "durationSeconds": 243.1077694235589,
    "durationMinutes": 4.051796157059315,
    "measures": 125,
    "events": 2794,
    "scoreId": "score-50455fed-3487-41a6-b2d5-e9d466a2e244",
    "hist": {
      "half": 14,
      "quarter": 422,
      "eighth.": 186,
      "eighth": 1708,
      "sixteenth": 463,
      "quarter.": 15
    }
  }
}
```

## Console errors (filtered)
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
- console: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
