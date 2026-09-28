"""Piano Vision V2.5: structure-first semantic OMR.

Versioning: inputs (INPUT_VERSION) and head vocabularies are unchanged from
V2, so V2 checkpoints load into the V2.5 trunk. What changes is the
representation and reasoning built on top:

- event-identity embeddings supervised by existing ATTACK/CHORD pairs
- per-relation-type refinement feedback (no single pooled bottleneck)
- object-set memory for the notation decoder (replaces mean-pooled page
  context; no K-nearest truncation, no geometric-rank features/targets)
- pointer attachment head with conservative masked supervision
- structural consistency losses (voice transitivity, tie-pitch agreement,
  duration-quarters agreement) requiring no new labels
- macro/focal rebalanced objective with syntax-downweighted notation loss
- per-head temperature calibration + abstention thresholds

Rejected and NOT carried forward: D1 candidate-anchor rank features/targets,
frozen-trunk ordinal classification head, scheduled sampling.
"""

ARCHITECTURE_VERSION = "piano-vision/2.5"
INPUT_VERSION = "musical-views/2"
VOCABULARY_VERSION = "written-semantics/2"
VERIFIER_VERSION = "rational-music/2"

# New parameter prefixes introduced by V2.5. Only these may be missing when
# loading a V2 checkpoint, and only these (plus the retired D1/ordinal keys)
# may be unexpected when loading a V2.5 checkpoint into a newer model.
V25_NEW_PREFIXES = (
    "event_projector.",
    "event_pair.",
    "relation_feedback.",
    "pointer.",
    "object_memory.",
    "notation_bias.",
)

# Retired experiment keys: accepted-but-ignored on load, never trained.
RETIRED_PREFIXES = (
    "ordinal_head.",
    "notation_decoder.cand_gate",
    "notation_decoder.cand_geo.",
    "notation_decoder.cand_kind.",
)
