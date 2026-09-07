# Corranzo Piano Vision v1 training stack

This developer-only package implements the Phase 2.14 multimodal model,
streaming score loader, production trainer, checkpoint manager, evaluator,
deterministic verifier, persisted dashboard, and closed-by-default full-data
launch gate. It is not imported by the Corranzo application.

The stable entry point is:

```sh
python3 tools/piano-vision/run.py --help
```

Post-build commands:

```sh
# Run only after the full factory process has stopped. While it is live this
# exits blocked without opening SQLite.
python3 tools/piano-vision/run.py prepare-full \
  --factory-dir tmp/campaign/pdmx-piano-vision-full-v1 \
  --campaign-dir tmp/campaign/piano-vision-phase214

# Display the immutable counts and integrity summary; this records nothing.
python3 tools/piano-vision/run.py review-full \
  --factory-dir tmp/campaign/pdmx-piano-vision-full-v1 \
  --campaign-dir tmp/campaign/piano-vision-phase214

# After a person has reviewed that summary, record the exact approval token.
python3 tools/piano-vision/run.py review-full \
  --factory-dir tmp/campaign/pdmx-piano-vision-full-v1 \
  --campaign-dir tmp/campaign/piano-vision-phase214 \
  --confirm HUMAN_REVIEW_COMPLETE

# Inspect the launch gate. This never starts training.
python3 tools/piano-vision/run.py gate \
  --factory-dir tmp/campaign/pdmx-piano-vision-full-v1 \
  --config tmp/campaign/piano-vision-phase214/piano-vision-v1-mac.frozen.json \
  --index tmp/campaign/piano-vision-phase214/full-semantic-index.json

# Serve a dashboard independently from a trainer process.
python3 tools/piano-vision/run.py dashboard \
  --run-dir tmp/campaign/piano-vision-phase214/runs/piano-vision-v1-001
```

`launch-full` requires every dataset/config gate plus the exact explicit
confirmation `HUMAN_REVIEW_COMPLETE`. The matching `human-review.json` must
already exist and must name the same factory, dataset digest, and manifest
digest. It cannot be triggered by the factory.

`prepare-full` combines completion/validation checks, deterministic index
generation, streaming shard hashing, whole-score and semantic-source split
checks, future-test locking, family counts, canonical/pixel availability and
training-byte estimation, and TINY workload estimation. It writes only to the
Piano Vision campaign directory. Every referenced page is decoded and hashed
as grayscale pixels: identical pages across splits block preparation, review,
and launch even when score IDs, archive bytes, or PNG metadata differ. These
checks never reassign a score's split. Liveness is established
from matching processes, open SQLite handles, and WAL quiescence. A stale WAL
becomes readable only after the process/open-file checks are clear and the WAL
has been unchanged for five minutes; it is then opened in SQLite read-only
query mode to verify persisted completion.

Run the bounded tests with:

```sh
PYTHONPATH=tools/piano-vision python3 -m unittest discover \
  -s tools/piano-vision/tests -v
```
