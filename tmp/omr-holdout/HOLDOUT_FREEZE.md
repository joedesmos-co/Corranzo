# Holdout freeze record

**Frozen at:** 2026-08-05 (intake acquisition)  
**Git HEAD:** `fc7af58`  
**Production OMR:** `f091ee7` (unchanged)  
**Freeze tests:** `613fa73`  
**Evaluator:** 2.0.0 / schema 2  

## Strict pack (immutable hashes)

| Holdout ID | SHA-256 | Split |
| --- | --- | --- |
| `guitar-bach-prelude-c-guitartab` | `e87a9ecf0282aae2d446f85c9370969494654e0ec425826ac97c63c6ae7a48de` | **evaluation (sealed, preserved)** |
| `guitar-bts-save-me-tab` | `217e16810477c04e2f7d838c56f7186813ef88a103d724a86b1d11b103eb5d4c` | **evaluation (sealed)** |
| `guitar-undertale-home-tab` | `e2a59cd9adfbc9c06ab50c6651d7e1e4fe1356de4c7a1cfe09dc6a29dd2584aa` | **evaluation (sealed)** |
| `piano-chainsaw-reze-in-the-pool` | `fe980bf620d6e821c89988c5c342ba8bcfcd4a81d342d874aa62f37ccdb24999` | **evaluation (sealed)** |
| `guitar-gravity-falls-theme-tab` | `d4ba9f101d4f29f3d2073c18bedf674adaa3e42863bda8c7e65b9becfb336cf5` | development |
| `guitar-guaraldi-pumpkin-waltz` | `38692266717ce58c5bd6436a6e48094a6e32d8a9cd065acc12f889f321d5f22b` | development (preserved) |
| `guitar-pachelbel-canon-d-tab` | `eeb769a7328265cbb9897732ac1e20d94bde806d1c94647634f8310913e16c96` | development |
| `guitar-pirates-caribbean-tab` | `f2b684aba5eade88b40ccde9fb841c30699a30fbe087ce86df784e3a0dc29892` | development (preserved) |
| `piano-korobeiniki-tetris-tiles` | `09bf784b684eef5baa399de5ccb92836dd9e350d1eb4462e14d6b152ee10da16` | development |
| `piano-pokemon-rby-title` | `f8ad96511dd1c25e94dd55a0c63fb4d29d779ce695476cd7d858341ea46b84aa` | development |
| `piano-super-mario-bros-theme` | `381c62726406a5d44fb710191d320cb4cc7e3fb420ce1df700a25348b7288e52` | development |

## Split method

1. Preserve prior assignments (Bach sealed; Guaraldi + Pirates development) — results already visible.  
2. New intake scores: strata round-robin `piano` → `guitar-tab-only` → `guitar-paired`, lex within strata.  
3. Seal new scores until overall sealed count ≈ `floor(11 × 0.4) = 4`.  
4. Do **not** move IDs after this freeze / after baseline results.

Sealed (4): Bach, BTS Save Me, Undertale Home, Chainsaw In the Pool.  
Development (7): Gravity Falls, Guaraldi, Pachelbel, Pirates, Korobeiniki, Pokémon, Mario.

## Freeze rules

1. Manifest frozen before any production changes.  
2. File hashes recorded above.  
3. Do not replace difficult holdouts.  
4. Do not remove a score because Corranzo performs poorly.  
5. Do not add only easy scores after seeing results.  
6. Do not move scores between splits after results.  
7. Evaluation holdouts sealed — no semantic-answer inspection while tuning.
