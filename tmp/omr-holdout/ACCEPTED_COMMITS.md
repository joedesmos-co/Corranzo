# Accepted holdout generalization commits

## `648651a` — fix(omr): recognize vector tuplet groups

- **Parent program HEAD:** `fc7af58`
- **Protected baseline still referenced:** production OMR historically `f091ee7`; freeze tests `613fa73`
- **Root cause:** Local vector piano tuplets (Pokémon + Mario) were omitted because recovery only handled full-bar uniform `beats×3` grids and digits above the staff; MusicXML lacked `<tuplet type="start|stop">`.
- **Fix:** Local digit-gated 3:2 groups (above/below), time-modification + balanced tuplet start/stop, local recovery disabled for fretted/TAB (`!tabCapable`).
- **Development before → after:**
  - `piano-pokemon-rby-title`: `tm=0/starts=0` → `tm=68/starts=15/stops=15`
  - `piano-super-mario-bros-theme`: `tm=0/starts=0` → `tm=34/starts=8/stops=8`
  - Other development holdouts: `tm=0` (no false tuplets on Guaraldi/Korobeiniki/TAB)
- **Frozen corpus:** Overall **88.2%** preserved; Articulation 100%; freeze tests 5/5
- **Sealed milestone (structural only):** 4/4 accepted; guitar sealed identical to untouched baseline; one sealed piano score gained 2 balanced tuplet groups (`tm=6`) — recorded, **not used for threshold tuning**
