# Full-scale semantic memory and resume repair

## Audit and scope

The read-only production audit on September 7, 2026 found 53,368 frozen planned
scores, 16,360 COMPLETE, 1,952 REVIEW, 35,056 REJECTED, no failed scores, and
18,312 canonical rows. Both semantic tables contained zero rows; both full and
semantic build states were RUNNING. No development writer or test was pointed
at this directory. Trainer/model Phase 2.16 was not changed.

The old assembler fetched all canonical rows, loaded each canonical JSON and
target bundle, and retained all constructed examples in per-split Python lists.
No semantic file or example row was emitted until every selected score had been
scanned. All final SQLite rows were then committed together. There was no
score-completion record, so zero-output scores could never be recognized on
resume. Validation retained all example IDs, and loader evaluation materialized
each entire split; both later memory hazards are also removed.

The old full-pipeline process PID 39743 was still present during the audit and
held the DB open (macOS process state U). This is not treated as an exited
worker. No signal was sent. The new command refuses to run while an older
matching full-pipeline process is present.
At the final process check that PID was a zombie with zero RSS; it no longer
executes work. The resume command still performs its own check when invoked.

## Streaming and transaction model

* Canonical selection uses score-ID keyset iteration, one row at a time.
* A standard-library streaming JSON reader extracts one canonical scope at a
  time with the same Python int/float decoding semantics as `json.load`.
* Targets stream into a temporary SQLite index for one score. Repeated target
  IDs retain the previous dictionary's last-occurrence-wins behavior. Only one
  target/scope and a bounded output chunk need be decoded at once.
* Default chunks hold at most 256 examples, stop after 256 visited scopes, and
  flush at 8 MiB of serialized example data or score end. A single larger
  example is never truncated; peak memory includes that largest atomic record,
  its queries, and decoded/serialized representations. SQLite caches are
  limited to 4 MiB (factory) and 2 MiB (temporary index).
* Files are gzip-written into `semantic-staging/*.partial`, flushed and fsynced,
  then atomically published to `semantic-shards`. Compression has empty filename
  and zero mtime for reproducible bytes. The output directory is fsynced.
* One SQLite transaction then records the shard hash, examples/digests/labels,
  split identities, errors, and last committed scope cursor. SQLite uses FULL
  synchronous mode and macOS fullfsync. The cursor never advances ahead of its
  durable outputs.
* A crash before publication leaves only disposable staging files. A crash
  after publication but before commit leaves an unregistered complete shard.
  Replay must reproduce its exact hash before adoption; mismatching finals are
  never overwritten. Existing committed shards are verified on resume.
* The score is terminal only after its last chunk commits. Terminal states are
  COMPLETE, EMPTY, SKIPPED (missing bundle), or REVIEW (missing targets/firewall
  exclusions). RUNNING plus scope cursor identifies an interrupted score.
* Canonical/target content and contract/chunk settings are fingerprinted for
  every score. Input drift and existing-example digest conflicts fail closed.
  Completed scores are fingerprint-checked, but their examples are not rebuilt.
  An interrupted score may reparse its target file and earlier source scopes to
  seek the committed cursor; it does not regenerate committed semantic examples.
* SIGINT and persisted pause/stop controls preserve the last committed chunk.
  Hard process exits leave the same recoverable state. A single-worker flock
  prevents concurrent semantic writers; a separate process probe covers the
  older worker that did not implement locks.
* Disk safety is checked before target-index writes, shard writes with a write
  reserve, and validation index growth. Production defaults remain 20 GiB.

Validation and loader evaluation now stream examples and use temporary SQLite
identity sets. Validation still returns the existing small future-heldout score
ID summary, whose size depends on the number of reserved scores; no corpus of
examples or labels is retained in RAM. Error summaries are capped at 100 while
assembly errors remain persisted in the database.

## Content and determinism

Families, label states, availability, semantic split policy, source tensor,
query construction, decoder contract, provenance and digest serialization are
unchanged. Missing target bundles/scopes and firewall violations retain their
previous exclusion behavior and are now durable score outcomes. Digest conflicts
are fatal rather than merely appearing in an assembly error list.

The new layout uses deterministic score-local chunks in score-ID/source-scope
order. The old layout grouped all scores by split before slicing shards; its
filenames/boundaries and timestamped gzip hashes are not retained. No schema or
loader requires the old cross-score boundaries: consumers use registered shards
or their generated manifest. Per-split example order is preserved. New
uninterrupted and resumed runs produce identical shard names and bytes for the
same inputs/settings. Existing legacy shards are retained without rewriting;
new missing examples are appended. A new dataset manifest must be prepared after
completion, as already required. The real factory had zero semantic outputs at
the audit, so there is no production semantic layout to migrate.

## Dashboard

`Factory.status().semantic` includes canonicalScoresTotal, scoresProcessed,
scoreStates, examplesEmitted, labelsEmitted, shardsEmitted, currentScoreId and
state. The dashboard adds Semantic Scores and a Semantic Assembly phase.
Example and label numerators reflect committed rows, even midway through a
large score. Their denominators remain CALCULATING until completion. Semantic
completion is no longer inferred from the presence of any shard.
Per-split totals commit in the same transaction as the chunk, so dashboard
refreshes do not scan all semantic example rows to update their counts.

## Validation

Run only bounded fixture tests:

```sh
PYTHONPATH=tools/pdmx-factory python3 -m unittest discover \
  -s tools/pdmx-factory -p 'test*.py' -v
```

The suite compares a frozen copy of the previous assembler against the new
implementation. The real-sample check copies 64 existing validated examples
from two scores into temporary fixtures: all 4,363 known labels, IDs, splits,
model inputs, semantic targets, queries, source/target digests and validation
results match exactly. No sample source is modified.

Memory is measured in separate processes for 8 scores/128 examples, 80 scores/
1,280 examples, and one large score/1,280 examples. Tests assert a four-example
buffer and bounded traced memory across tenfold growth and a large single
score. Typical traced peaks are 1.45–1.55 MB, with process RSS approximately
54–58 MB. These fixtures prove allocation behavior; they are not a prediction
of full-corpus throughput or the largest production scope's memory.

Regression coverage includes content equality, byte/record bounds, incremental
counters, clean stop, pause controls, SIGINT, hard process exit, interruption
after partial fsync/publication/before commit/after commit, zero-output and
missing-target scores, old-output adoption, idempotence, exact resumed shard
hashes, conflicting digests, source split leakage, corruption, disk floor,
legacy worker exclusion and semantic-only pipeline execution. The latter runs
with nonexistent archives and patched physical operations that raise if called.
All 19 bounded tests passed in 15.464 seconds. Observed memory evidence:

| Fixture | Examples | Traced peak bytes | Peak RSS bytes |
| --- | ---: | ---: | ---: |
| 8 scores | 128 | 1,450,797 | 53,952,512 |
| 80 scores | 1,280 | 1,481,481 | 54,837,248 |
| One large score | 1,280 | 1,543,512 | 57,278,464 |

The local checkpoint first tracks this previously untracked factory package's
semantic entry points and the existing Python support modules needed to execute
them and their tests. It excludes campaign evidence, archives, canonical files,
training/model code, caches, and unrelated worktree changes.

## Explicit resume command — do not execute during development

After the existing old worker has exited, from the repository root:

```sh
python3 tools/pdmx-factory/full_pipeline.py \
  --work-dir tmp/campaign/pdmx-piano-vision-full-v1 \
  --csv /Users/ryland/Downloads/PDMX.csv \
  --pdf-archive /Users/ryland/Downloads/pdf.tar.gz \
  --mxl-archive /Users/ryland/Downloads/mxl.tar.gz \
  --subset-paths /Users/ryland/Downloads/subset_paths.tar.gz \
  --model-contract tmp/campaign/piano-vision-phase212y/factory-model-contract.json \
  --disk-floor-gib 20 \
  --semantic-only --resume
```

`--semantic-only` verifies the frozen physical plan is finalized and canonical
counts match accepted plus review. It bypasses setup validation, CSV/archive
inspection, preflight, physical build, and source production. `--resume`
explicitly clears persisted pause/stop flags. Then it assembles/resumes semantic
output, validates semantic output, validates the existing generic dataset,
evaluates the loader, and finally marks the full build COMPLETE. The command
does not train any model. It refuses to compete with an older matching worker.

No automatic restart or training hook was added. Development ends with the
local code checkpoint and this command; it does not execute the command.
