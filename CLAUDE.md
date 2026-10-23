# CLAUDE.md

Local-first macOS financial simulator (Tauri 2 + React/TS + Rust engine + SQLite). Product spec and phase plan: `docs/SPEC.md`. Read it before starting a phase.

## Primary user
A wealthy, retired single mother in Texas, weighing estate/gift decisions (gifting houses to her kids, family LLCs, early inheritance). Optimize UX and features for her first. Secondary: a 28-year-old early-career user.

## Architecture rules
- `engine/` is pure Rust with no Tauri, DB, or IO dependencies. All financial math lives here and gets unit tests.
- The household data model lives in `engine/src/model.rs` (types + validation). `src/lib/types.ts` mirrors it by hand, so change both together.
- All SQLite access goes through `src-tauri/src/db/`. The UI only calls Tauri commands, via `src/lib/api.ts`. Mutating commands return the full `Household`.
- Migrations: append a new `src-tauri/migrations/NNNN_*.sql` and add it to `MIGRATIONS` in `db/mod.rs`. Never edit a shipped migration.
- Demo households are JSON in `fixtures/`, loaded through the same validated path as real data.
- Tax law values belong in data files (`engine/tax_tables/<year>.json`), never hard-coded. Note the source in the file when updating.
- Preview a demo forecast outside Tauri: `FSIM_DUMP=out.json cargo test dump_demo -- --ignored` writes household + projection JSON.
- Federal taxes only (plus an optional flat state rate). Planning-grade accuracy.
- Scenarios = base plan + `Event` decisions (`engine/src/model.rs`), applied in `projection.rs`. The estate math is in `estate.rs`. Every projection/simulation command takes an optional scenario id (`None` = base plan). Estate figures shown to users must keep the heirs'-tax assumption and the not-legal-advice note visible (`FamilyCard.tsx`, MethodNote, README "Scenarios, gifts & estate").
- Range of outcomes = **centered historical replay only** (`engine/src/history.rs`, `montecarlo.rs`); no parametric returns. If the method changes, update all three explanations together: `src/components/MethodNote.tsx`, README "How the forecast works", and the `docs/SPEC.md` Decisions log.
- Never commit real personal data (`*.sqlite`, `*.fsim` are gitignored).

## Commands
- `npm run app`: run the desktop app
- `npm run check`: lint + all tests. Run this before committing.
- `npm run release`: signed + notarized DMG to the Desktop (see README "Releasing"). Never commit certs or passwords.
- `npm run test:rust` / `npm test`

## Conventions
- Every Rust struct sent to the UI uses `#[serde(rename_all = "camelCase")]`. TS mirrors live in `src/lib/types.ts` (household) and `src/lib/projection.ts` (forecast output); keep them in sync.
- Money is `f64` dollars; rates are decimals (0.07 = 7%).
