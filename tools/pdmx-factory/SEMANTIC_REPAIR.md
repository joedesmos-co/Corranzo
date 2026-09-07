# Semantic-only revision repair

`content_splits.py` decodes every referenced page to grayscale and unions whole
scores sharing identical dimension-qualified pixels. Each component inherits its
strictest existing split: future-test > test > validation > train. The versioned
manifest retains original assignments and before/after counts and cannot be
overwritten. Historical physical/source split metadata stays unchanged.

`semantic_repair.py` streams the original MXL archive once, reading one bounded
member in memory and verifying its hash against canonical provenance. It never
extracts archives or invokes physical/source production. It reuses frozen,
truth-independent rest graph primitives and existing notehead mappings. Only
REST and TUPLET target families may change; all other families and original
physical objects are checked for exact equality. Appended rest objects are
semantic input overlays derived from existing primitives, not edits to canonical
physical inventories.

Tuplets require consistently paired, numbered written boundaries. Ordinary-note
interruptions, incomplete/contradictory markup, unresolved nested ratios, and
missing source attachments abstain. Nested levels retain explicit level ratios.
A time-modification ratio alone does not establish a written group. Rest mappings
require source-coordinate containment and unique staff/glyph-compatible monotonic
alignment. Missing, simultaneous, overlapping, or incompatible alignment abstains;
it never invents a negative rest label.

## Durability and disk

The worker snapshots the original semantic index and freezes the code/contract/
split recipe in `semantic-revisions/<revision>`. Original targets, canonical
files, physical DB tables, rendered pages and archives remain intact.

Each score uses the existing bounded emitter in a disposable staging DB. Buffers
remain bounded to 256 examples or 8 MiB plus one example. Shards are fsynced before
the staging transaction, and orphan adoption requires exact replay hashes. A
complete staged score must pass validation and retain its example count before
one main-DB transaction swaps its indexes. Old shards can be reclaimed only after
verifying the committed replacement hashes. Interruption on either side of the
swap is resumable using the identical command.

Only one score is duplicated temporarily. The hard floor is 20 GiB, with at least
128 MiB additional write reserve, or four times the old compressed score size
when larger. Checks repeat at every semantic buffer write. Disk refusal or
SIGTERM pauses safely. Changed recipe/code/input hashes reject resume. There is
no corpus-sized example buffer or second complete semantic dataset.

Regeneration deliberately leaves `semantic_build_state` RUNNING and reports
`REPAIR_REGENERATED_PENDING_FULL_AUDIT`. Complete audits must pass before factory
completion and readiness preparation. Regeneration does not record human review
or authorize training.

```sh
python3 tools/pdmx-factory/content_splits.py \
  --factory-dir FACTORY --output VERSIONED_AUDIT_DIR --version VERSION
python3 tools/pdmx-factory/semantic_repair.py \
  --factory-dir FACTORY --model-contract CONTRACT \
  --split-manifest VERSIONED_AUDIT_DIR/split-manifest.json \
  --mxl-archive ORIGINAL_MXL_ARCHIVE --revision REVISION
```

`--max-scores` sets a bounded repair milestone. Repeating without it resumes the
same revision, without changing the physical plan.

Tests use temporary factories for publication/swap interruption, deterministic
resume, recipe protection, disk refusal, and transitive holdout isolation.
`tools/semantic-gold/repair.test.mjs` covers adjacent same-ratio tuplets, ordinary
separators, nested/crossing structures, malformed boundaries, rest members,
truth-independent rest coordinates, and conservative abstention. Existing
streaming and semantic-gold suites remain applicable.
