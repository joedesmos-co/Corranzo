# Harmony error attribution (real mixes, TRIOS MIDI reference)

| take | windows | root+quality acc | underdetermined | underdet% | with-drum acc | no-drum acc | boundary MAE s |
|---|---|---|---|---|---|---|---|
| mozart | 40 | 0.35 | 25 | 63% | null (0) | 0.35 (40) | 0.078 |
| schubert | 59 | 0.237 | 26 | 44% | null (0) | 0.237 (59) | 0.142 |
| brahms | 90 | 0.222 | 25 | 28% | null (0) | 0.222 (90) | 0.064 |
| lussier | 20 | 0.4 | 12 | 60% | null (0) | 0.4 (20) | 0.103 |
| take_five | 60 | 0.217 | 74 | 123% | 0.217 (60) | null (0) | 0.047 |

## Chord confidence vs correctness (point-biserial; buckets low<0.5 mid<0.75 high)

- mozart: r=0.245 {"mid":{"accuracy":0.227,"n":22},"high":{"accuracy":0.5,"n":18}}
- schubert: r=-0.064 {"mid":{"accuracy":0.233,"n":30},"high":{"accuracy":0.241,"n":29}}
- brahms: r=0.043 {"mid":{"accuracy":0.227,"n":44},"high":{"accuracy":0.217,"n":46}}
- lussier: r=-0.189 {"mid":{"accuracy":0.455,"n":11},"high":{"accuracy":0.333,"n":9}}
- take_five: r=-0.261 {"mid":{"accuracy":0.271,"n":48},"high":{"accuracy":0,"n":12}}

## Failure categories per take

- mozart: reference-underdetermined=25, root-ok-quality-ok=14, bass-disagree=9, seventh-confusion=10, invented-pc=6, quality-other=1
- schubert: reference-underdetermined=26, bass-disagree=23, melody-as-root=5, seventh-confusion=9, root-ok-quality-ok=14, quality-major-minor=2, invented-pc=6
- brahms: reference-underdetermined=25, melody-as-root=15, root-ok-quality-ok=20, bass-disagree=30, seventh-confusion=10, invented-pc=13, quality-major-minor=2
- lussier: reference-underdetermined=12, root-ok-quality-ok=8, invented-pc=4, melody-as-root=4, seventh-confusion=2, quality-major-minor=1, bass-disagree=1
- take_five: reference-underdetermined=74, bass-disagree=22, quality-major-minor=10, seventh-confusion=4, invented-pc=8, quality-other=2, root-ok-quality-ok=13, melody-as-root=1
