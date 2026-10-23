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

The same explanation is always visible in the app, under the headline ("How this works"). The decisions behind this are logged in `docs/SPEC.md` → Decisions log.

### Data & definitions
*Mirrored in the app's "How this works" panel. The numbers come from `src/lib/simulation.ts` (`THRESHOLDS`, `DATA_SOURCES`), so update both together.*

**Sources** (`engine/data/historical_returns.csv`, 1928–2025, 98 years):
- **Market returns:** A. Damodaran, NYU Stern, ["Historical Returns on Stocks, Bonds and Bills"](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html), updated January 5, 2026. The series are the S&P 500 including dividends, the 10-year US Treasury bond total return, the 3-month T-bill (cash), and US home prices (real estate).
- **Inflation:** US Bureau of Labor Statistics, CPI-U all items (series `CUUR0000SA0`), December to December. Pulled from the BLS public API.

**How the data was checked:**
- Compounding every year's figures reproduces the source's own "$100 invested in 1928" totals through 2024 to within 0.1% (stocks, T-bills, T-bonds, real estate).
- Known years match published figures: 1931 stocks −43.8%, 2008 −36.6%, 2022 −18.0%, 1980 inflation 12.5%.
- Long-run compound averages: stocks 10.0%/yr, inflation 3.0%/yr. Engine tests (`engine/src/history.rs`) check these.
- **Known quirk:** the source's 2025 Treasury bond row says 7.80%, while its own running total implies 8.29%. The app uses 7.80%.

**Definitions:**
- **Money lasts:** every year's spending, taxes, and debt payments were paid through the plan's last age.
- **Live off growth & income:** the scenario ends with at least today's spendable savings (cash, brokerage, retirement accounts) after inflation. Real estate isn't counted, since it's never sold to pay bills.
- **Rough / typical / strong:** the scenarios at the 10th / 50th / 90th percentile of ending spendable savings. **Worst** is the single toughest scenario.
- **Shaded bands:** the 10th–90th percentile (8 in 10 scenarios) and the 25th–75th percentile (the middle half).

**Status colors and flags:**

| What | Check (good) | Caution | Alert |
| --- | --- | --- | --- |
| Chance the money lasts | 90%+ | 75–90% | below 75% |
| Chance you live off growth & income (stricter goal) | 75%+ | 40–75% | below 40% |

When you zoom in on a scenario, a year is flagged as a **big stock drop** when stocks fall 15% or more, and as **high inflation** when prices rise 6% or more. Both are measured after scaling to your Assumptions.

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
