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

## How the forecast works
The **Forecast** page has two views:

- **Range of outcomes** (default): thousands of scenarios, each replaying **real US market years from 1928–2025** (stocks, bonds, T-bills, home prices *and* inflation) in random runs of 5 consecutive years, through the same yearly tax-aware projection as the steady path.
  - **Scaled to your Assumptions.** History is centered so its long-run compound average equals your Assumptions (default 7% stocks, 2.5% inflation): `(1 + r') = (1 + r) × (1 + target) / (1 + historical average)`. US stocks actually compounded about 10%/yr over that period. Crashes and booms keep their relative size: 2008's −37% becomes about −38% at 7%. Set stocks to 10% to see essentially unadjusted history.
    - Why scale down: forecasts for the coming decade are mostly below past averages, real accounts pay fees, the US was the best-performing market of the last century, and over-optimism is the costly mistake when deciding how much to give away.
  - **Results:** the chance the money lasts, the chance of living off growth & income (ending with at least today's spendable savings after inflation), a fan chart of spendable savings, and a zoom-in on rough / typical / strong / worst scenarios showing exactly which years each one replayed.
  - **Limits:** no single year is worse than history's worst (1931). It's US history only. All stocks move with the market (a single-stock risk model comes with ticker data in Phase 6).
- **Steady path:** your Assumptions every single year. Useful as a simple reference line, plus the Social Security claim-age comparison.

The same explanation is always visible in the app, under the headline ("How this works"). Data: A. Damodaran, NYU Stern (returns) and BLS CPI-U (inflation); see `engine/data/historical_returns.csv`. The decisions behind this are logged in `docs/SPEC.md` → Decisions log.

## Releasing (signed DMG to share)
`npm run release` builds a universal app, signs it with your Developer ID, has Apple notarize it, and copies `Finance Simulator <version>.dmg` to your Desktop. Recipients can open it with a plain double-click.

One-time setup:
1. A **Developer ID Application** certificate in your keychain. Check with `security find-identity -v -p codesigning`. If it shows as invalid, install Apple's [Developer ID G2 intermediate](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer).
2. Notary credentials saved in your keychain. Run this in Terminal; it prompts for an app-specific password:
   `xcrun notarytool store-credentials fsim-notary --apple-id <you@email> --team-id <TEAMID>`

Bump `version` in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml` before each release. Never commit certificates or passwords.

Your data lives at `~/Library/Application Support/com.foehner.financesimulator/household.sqlite` (also shown in Settings).

## Layout
```
engine/        Rust simulation engine (pure, unit-tested)
src-tauri/     Tauri app: commands (lib.rs), SQLite (db.rs), migrations/
src/           React UI: pages/, components/, lib/api.ts (typed Tauri calls)
docs/SPEC.md   Product spec and phase plan
```
