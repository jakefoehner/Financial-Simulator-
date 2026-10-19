# Finance Simulator

A local-first macOS app for financial what-if planning: Monte Carlo forecasts, federal taxes, and estate/gifting scenarios. All data stays in a SQLite file on your Mac.

See [`docs/SPEC.md`](docs/SPEC.md) for the full spec and phase plan.

## Stack
- **Tauri 2** desktop shell (macOS)
- **React + TypeScript + Vite + Tailwind** UI in `src/`
- **Rust** engine (projection, tax, Monte Carlo) in `engine/`: no UI or DB dependencies
- **SQLite** (rusqlite, bundled) in `src-tauri/`, with SQL migrations in `src-tauri/migrations/`

## Setup (once)
```sh
# Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install
```

## Everyday commands
| Command | What it does |
| --- | --- |
| `npm run app` | Launch the desktop app with hot reload |
| `npm test` | Frontend unit tests (Vitest) |
| `npm run test:rust` | Engine + DB tests (`cargo test`) |
| `npm run lint` | Typecheck, Prettier, rustfmt, Clippy |
| `npm run check` | Lint + all tests |
| `npm run format` | Auto-format TS and Rust |
| `npm run bundle` | Build `Finance Simulator.app` + `.dmg` into `target/release/bundle/` |

Your data lives at `~/Library/Application Support/com.foehner.financesimulator/household.sqlite` (also shown in Settings).

## Layout
```
engine/        Rust simulation engine (pure, unit-tested)
src-tauri/     Tauri app: commands (lib.rs), SQLite (db.rs), migrations/
src/           React UI: pages/, components/, lib/api.ts (typed Tauri calls)
docs/SPEC.md   Product spec and phase plan
```
