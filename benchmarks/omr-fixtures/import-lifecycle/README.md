# Import lifecycle surrogates

These are **surrogates** for the user-reported `hikaru-nara.pdf` (5-page lead
sheet). The original file was not available to the research agent.

- `valid-standard-5p.pdf` — five copies of the standard-notation fixture.
  OMR fills every measure; the import must reach **Your score is ready**.
- `partial-measure-5p.pdf` — five pages of staves with two noteheads per
  measure (deliberately short measures). OMR detects notes but cannot build
  reliable measure timing; the import must reach a **recoverable failure**
  with "Try again", never an actionless "Checking your score".

Generated with PyMuPDF for test-only use; no third-party content.

Reproduce:

```
npx vite --port 5200 --strictPort
node scripts/guitar-import-lifecycle-e2e.mjs benchmarks/omr-fixtures/import-lifecycle/partial-measure-5p.pdf
node scripts/guitar-import-lifecycle-e2e.mjs benchmarks/omr-fixtures/import-lifecycle/valid-standard-5p.pdf
```
