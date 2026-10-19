# CLAUDE.md

Local-first macOS financial simulator (Tauri 2 + React/TS + Rust engine + SQLite). Product spec and phase plan: `docs/SPEC.md`. Read it before starting a phase.

## Primary user
A wealthy, retired single mother in Texas, weighing estate/gift decisions (gifting houses to her kids, family LLCs, early inheritance). Optimize UX and features for her first. Secondary: a 28-year-old early-career user.

## Architecture rules
- `engine/` is pure Rust with no Tauri, DB, or IO dependencies. All financial math lives here and gets unit tests.
- All SQLite access goes through `src-tauri/src/db.rs`. The UI only calls Tauri commands, via `src/lib/api.ts`.
- Migrations: append a new `src-tauri/migrations/NNNN_*.sql` and add it to `MIGRATIONS` in `db.rs`. Never edit a shipped migration.
- Tax law values belong in data files (`engine/tax_tables/<year>.json`), never hard-coded.
- Federal taxes only (plus an optional flat state rate). Planning-grade accuracy.
- Never commit real personal data (`*.sqlite`, `*.fsim` are gitignored).

## Commands
- `npm run app`: run the desktop app
- `npm run check`: lint + all tests. Run this before committing.
- `npm run test:rust` / `npm test`

## Conventions
- Rust structs sent to the UI use `#[serde(rename_all = "camelCase")]` for app types. Engine output structs are currently snake_case; keep `api.ts` types in sync.
- Money is `f64` dollars; rates are decimals (0.07 = 7%).
