#!/bin/bash
set -e
cd /Users/ryland/Documents/scoreflow
D=$HOME/Downloads
F=benchmarks/omr-fixtures
A=tmp/omr-quality-campaign/attempts/phase1-primary-beam
run() {
  id=$1; truth=$2; pdf=$3; pages=$4
  echo "=== $id (pages=$pages) ==="
  node scripts/evaluate-omr-semantic.mjs --truth "$truth" --pdf "$pdf" \
    --mode written --max-pages "$pages" \
    --save-generated "$A/generated/$id.musicxml" \
    --json "$A/reports/$id.json" --text "$A/reports/$id.txt" --compact
}
run minecraft "$D/beginner-minecraft-piano-themes-in-c-minecraft.mxl" "$D/beginner-minecraft-piano-themes-in-c-minecraft.pdf" 1
run evangelion "$D/a-cruel-angels-thesis-neon-genesis-evangelion.mxl" "$D/a-cruel-angels-thesis-neon-genesis-evangelion.pdf" 1
run gymnopedie "$D/gymnopedie-no-1-satie.mxl" "$D/gymnopedie-no-1-satie.pdf" 1
run piano-articulation-scan "$F/piano-articulation-scan/piano-articulation-scan.musicxml" "$F/piano-articulation-scan/piano-articulation-scan.pdf" 1
run piano-grand-voices-vector "$F/piano-grand-voices-vector/piano-grand-voices-vector.musicxml" "$F/piano-grand-voices-vector/piano-grand-voices-vector.pdf" 1
run piano-rhythm-tuplets-vector "$F/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml" "$F/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf" 1
run piano-dense-advanced-vector "$F/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml" "$F/piano-dense-advanced-vector/piano-dense-advanced-vector.pdf" 1
run la-campanella "$D/etude-s-1413-in-g-minor-la-campanella-liszt.mxl" "$D/etude-s-1413-in-g-minor-la-campanella-liszt.pdf" 2
run fantaisie-impromptu "$D/fantaisie-impromptu-in-c-minor-chopin.mxl" "$D/fantaisie-impromptu-in-c-minor-chopin.pdf" 2
run moonlight-3 "$D/sonate-no-14-moonlight-3rd-movement.mxl" "$D/sonate-no-14-moonlight-3rd-movement.pdf" 2
run hungarian-dance-no5 "$D/hungarian-dance-no5.mxl" "$D/hungarian-dance-no5.pdf" 2
run carol-of-the-bells "$D/carol-of-the-bells.mxl" "$D/carol-of-the-bells.pdf" 2
