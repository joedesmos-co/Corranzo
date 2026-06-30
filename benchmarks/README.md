# Alignment benchmark corpus

See [docs/alignment-benchmark.md](../docs/alignment-benchmark.md).

- **Manifest:** `alignment-corpus.manifest.json`
- **Cache (gitignored):** `cache/<piece-id>/` — downloaded Mutopia assets
- **Do not commit** PDF/MIDI/MusicXML downloads

## OMR benchmark fixtures

The OMR benchmark manifest is `omr-benchmark.manifest.json`. It currently covers
two local fixtures:

- `clean`: Gymnopedie No. 1, used as the no-regression guard.
- `dense`: A Cruel Angel's Thesis, used as the dense rhythm/grouping stress
  fixture.

Run the dashboard with:

```sh
npm run omr:benchmark-dashboard
```

Reports are written to `tmp/omr-benchmark-dashboard/`. See
[docs/OMR_BENCHMARK_DASHBOARD.md](../docs/OMR_BENCHMARK_DASHBOARD.md) for the
dashboard workflow and [OMR_ENGINE.md](../OMR_ENGINE.md) for the current OMR
engine checkpoint.

Do not commit downloaded PDF/MIDI/MusicXML benchmark assets.
