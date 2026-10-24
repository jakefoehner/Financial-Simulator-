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
- Private-investment and startup outcome assumptions live in `engine/src/montecarlo.rs` and are mirrored in `src/lib/simulation.ts` (`PRIVATE_ASSUMPTIONS`); change both together. The solver is `engine/src/solver.rs`.
- Scenarios = base plan + `Event` decisions (`engine/src/model.rs`), applied in `projection.rs`. The estate math is in `estate.rs`. Every projection/simulation command takes an optional scenario id (`None` = base plan). Estate figures shown to users must keep the heirs'-tax assumption and the not-legal-advice note visible (`FamilyCard.tsx`, MethodNote, README "Scenarios, gifts & estate").
- Range of outcomes = **centered historical replay only** (`engine/src/history.rs`, `montecarlo.rs`); no parametric returns. If the method changes, update all three explanations together: `src/components/MethodNote.tsx`, README "How the forecast works", and the `docs/SPEC.md` Decisions log.
- Gifts have two sides in `projection.rs`: what a child receives (`ChildAmount`, used for the family totals) and what's reported to the gift ledger (exclusion/exemption). Tuition/medical, 529 superfunding, LLC discounts and GRAT remainders differ between the two; keep that split when adding transfer types.
- Prices: `src-tauri/src/prices.rs` (Yahoo chart API, cached in `ticker_data`; the only network code). Single-stock risk: `engine/src/stocks.rs`; `Household.stock_risk` is computed in `Family::household_for_engine`, never stored. Keep the README, MethodNote "Single stocks" and the SPEC in sync if the method changes.
- Brokerage imports live in `src-tauri/src/import.rs` (column-name aliases per brokerage, test files in `fixtures/imports/`). Account positions are `Account.holdings`, stored as JSON.
- Households: yours is `household.sqlite`; each child household is its own file, managed by `src-tauri/src/family.rs`. Every command works on the household being viewed (`Family::conn`). App settings and the household list live in the main file. `Household.incoming` (money from a linked parent plan) is computed by `Family::household_for_engine`, never stored or backed up.
- Backups (`src-tauri/src/backup.rs`) must open in every later version. Any new `Household` field needs `#[serde(default)]`. Renaming, moving or removing one needs an `upgrade()` step, a `FORMAT_VERSION` bump, and a new golden file (`cargo test -p finance-simulator write_golden -- --ignored`). Never edit or delete files in `fixtures/backups/`.
- Never commit real personal data (`*.sqlite`, `*.fsim` are gitignored; `fixtures/backups/` holds demo data only).

## Commands
- `npm run app`: run the desktop app
- `npm run check`: lint + all tests. Run this before committing.
- `npm run release`: signed + notarized DMG to the Desktop (see README "Releasing"). Never commit certs or passwords.
- `npm run test:rust` / `npm test`

## Conventions
- Every Rust struct sent to the UI uses `#[serde(rename_all = "camelCase")]`. TS mirrors live in `src/lib/types.ts` (household) and `src/lib/projection.ts` (forecast output); keep them in sync.
- Money is `f64` dollars; rates are decimals (0.07 = 7%).
