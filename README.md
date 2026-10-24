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

## Scenarios, gifts & estate
The **Scenarios** page holds "what if" plans. Each one is your base plan plus a timeline of decisions (ages are the primary person's; money is in today's dollars):
- help a child buy a home (a down-payment gift, optionally plus a family loan)
- cash gifts (once or yearly, including "the yearly maximum to each child")
- family loans
- stock or investments given in kind
- a 529 for a child (optionally superfunded) and tuition/medical bills paid directly
- gifts to charity or a donor-advised fund (cash or appreciated stock), and a charitable bequest
- a family LLC with yearly discounted gifts of shares
- GRATs (grantor retained annuity trusts), optionally rolled
- Roth conversions
- a spending change
- a different Social Security age

Any plan can be viewed on the Forecast page, and two or three can be compared side by side.

*Mirrored in the app's "How this works" panel (Estate & gifts) and the Forecast's "For the family" card. The figures come from `engine/tax_tables/2026.json`.*

- **Gift tax:** up to **$19,000** per person per year (2026, indexed) is excluded. Larger gifts use part of the **$15M lifetime exemption** (2026; made permanent and indexed from 2027 by the 2025 One Big Beautiful Bill Act). No gift tax is due until the exemption is used up.
- **Estate tax:** at the estate age (the plan's last year by default, or set in Assumptions), 40% × (net worth + gifts that used the exemption − exemption). Family loans still owed count as an asset. Federal only; Texas has no estate or inheritance tax.
- **"What if the exemption is cut":** an Assumptions switch. From a year you pick, the exemption becomes an amount you set in today's dollars (suggested: $7M, roughly the pre-2018 rules today).
- **Heirs' taxes:** inherited traditional IRA/401(k) money must be withdrawn within 10 years and is taxed as the kids' income. The app **assumes 24%** by default; change it in Assumptions. This assumption is shown on every "For the family" card. Other inherited assets get a stepped-up cost basis, so no capital-gains tax on past growth. Gifts keep the giver's basis.
- **What the kids receive:**
  - each child's lifetime gifts plus an equal share of the inheritance after estate tax and heirs' income tax
  - gifts are **grown to the estate date at your own portfolio's yearly return**, so giving early is compared fairly with money kept (which also grows)
  - the card shows both "given" and "worth by then"
- **Family loans:** the rate defaults to the IRS minimum (applicable federal rate, Rev. Rul. 2026-21, Nov 2026): 4.67% for up to 3 years, 5.08% up to 9, 5.52% beyond. Payments come back to you (the interest is taxable income). Forgiven principal counts as a gift.
- **Gifting stock or investments in kind** ("put stock in the kids' names"): the gift is valued at market (a stock split doesn't change that), and the kids **keep your cost basis**. What they receive subtracts the capital-gains tax they'd owe selling, at an **assumed 15%** (editable). Stock kept until death is stepped up instead, so low-basis stock is often better kept and cash or high-basis shares given.
- **Anti-clawback** (Treasury regulations, 2019): if the exemption is cut after you've used it, gifts already sheltered stay sheltered. The estate uses the larger of the exemption at death and what your gifts locked in. For an estate far above both levels, a gift saves 40% of the growth after the gift either way; the rule matters most near the exemption.
- **"What if taxes rise"** (Assumptions): from a chosen year, every income-tax bracket and the 15%/20% capital-gains rates rise by the points you set.
- **"How much can you safely give?"** (Scenarios page): the largest gift, split evenly between the children (once now, or every year for N years), that keeps the chance the money lasts at or above a target (default 95%). It runs the same replayed-history scenarios at every trial amount, so a bigger gift never looks safer by luck. The answer is rounded down and re-checked with the full scenario count, and "Make this a plan" saves it.
- **Giving guide:** every strategy in plain English, with pros, cons, what the app models, and "Try this in a plan".
- **Itemized deductions** (One Big Beautiful Bill Act rules from 2026), taken each year only when larger than the standard deduction. The senior deduction applies either way.
  - **State and local taxes (SALT):** your home property tax (Spending page) plus the flat state rate's income tax, capped at **$40,400** in 2026 (+1% a year through 2029). The cap shrinks by 30% of income above **$505,000** (rising 1% a year), never below $10,000, and is a flat **$10,000** from 2030.
  - **Home mortgage interest:** debts marked "the mortgage on my home", on up to $750,000 of the loan.
  - **Charity:** cash up to 60% of income (AGI), appreciated stock up to 30%. Anything above carries forward **5 years**, this year's gifts used first. Itemizers deduct only giving above **0.5% of AGI**.
  - **35% cap:** for the 37% bracket, itemized deductions are reduced by 2/37 of the smaller of the deductions or the income reaching into that bracket, so each dollar saves at most 35 cents.
  - **Non-itemizers** deduct up to **$1,000** ($2,000 joint) of cash given straight to charities, not to a donor-advised fund.
- **Charity:** appreciated stock given is deductible at market value, and its gain is never taxed. Cash and stock both leave your estate.
  - A **charitable bequest** (a share of the estate) is deducted before estate tax. With "IRA money first", it comes out of the traditional IRA, so the kids inherit less of the income-taxed IRA.
- **529 plans:** money put in leaves your estate and grows tax-free for the child; the app assumes it's spent on education.
  - **Superfunding** counts up to 5 × the yearly exclusion ($95,000 in 2026) as five years of yearly gifts, one-fifth a year, so it uses no lifetime exemption. If the estate date falls within the five years, the part not yet counted goes back into the estate.
  - Because amounts are in today's dollars and the exclusion rounds down to $1,000, a 529 made next year at exactly $95,000 has a sliver above the limit.
- **Tuition and medical bills paid directly** to the school or provider aren't gifts at all: no limit, and no exclusion or exemption used. They still count toward what that child receives, grown like any gift.
- **Family LLC:** at the age you choose, the amount moves from the account into an LLC invested the same way. It's still yours: not spendable, and its income is taxed to you.
  - Each year for N years, a share of the LLC goes to the kids, split evenly. They receive its full value (with your cost basis), but the gift is **reported at the discount you set** (20–35% is typical, max 60%).
  - Once you own **half or less**, your remaining share is valued at the discount in the estate too.
  - The IRS challenges aggressive discounts: it needs a business purpose, a qualified appraisal and LLC formalities. The app says so wherever an LLC appears.
- **GRATs:** the amount moves into a trust invested like the source account. It pays you a level annuity whose present value at the **IRS §7520 rate (6.20%, November 2026, Rev. Rul. 2026-21 Table 5)** equals what went in. That's a "zeroed-out" GRAT: the gift counts as about $0.
  - Payments are made at each anniversary. Whatever is left at the end of the term goes to the kids at your basis.
  - **Rolling:** each payment starts a new GRAT of the same length, through the age you choose.
  - Income is taxed to you (a grantor trust). If the estate date falls during a term, the GRAT is still in your estate.
  - The rate is held at today's 6.20% for all future years.
  - On the steady path, a mixed portfolio earning under 6.2% passes nothing. GRATs pay off in strong markets, so Compare adds a "strong markets" (9 in 10) row when a plan has one.
- **Not modeled:** state taxes beyond a flat rate; the IRS valuation discount of LLC shares you keep while still in control; AMT.

## Private investments
Accounts can be **Private real estate fund**, **Private credit fund**, **Startup / angel investments**, or **Other private investment**. Each has current value, amount invested, yearly cash paid out (as a share of what was invested), the taxable share of that cash, an exit year and multiple, and for startups the number of companies and a QSBS flag.
- **Payouts:** cash comes in yearly. The taxable part counts as rental income (real estate funds) or interest (others).
- **Value and sale:** value grows toward the exit value, moving with replayed home prices (real estate) or stocks (startups, other) in each scenario. At exit the proceeds go to savings and the gain is taxed as a long-term gain (or excluded under QSBS). Losses offset gains, plus up to $3,000 of ordinary income.
- **Never sold early:** private investments count in net worth and the estate, but are never sold to pay bills before they pay out.
- **Startups in the range of outcomes:**
  - each company draws an outcome: about 55% return nothing, 15% return 0.5×, 10% return 1×, 10% return 3×, 7% return 10×, 3% return 30×
  - the draws are scaled so the average equals the expected multiple you set
  - more companies means a smoother result
- **Private credit:** a 3% yearly chance of a default costing 25% of principal. The steady path assumes none.
- These are planning assumptions (`engine/src/montecarlo.rs`, mirrored in `src/lib/simulation.ts`).
- **Limits:** this is a planning estimate, not legal or tax advice. Confirm big gifting decisions with an estate attorney.

## Family households
Each child listed on your People page can have a **full household of their own**: people (their spouse or kids), accounts, income, debts, spending, plans, and a forecast, the same as yours. **Build Sam's household** on the People page creates it. Switch between households at the top of the sidebar.

- **Linked to yours.** A child's household picks one of your plans (on its Forecast, "From Pat's plan"). Everything that plan sends that child arrives as money in their forecast:
  - cash gifts and down-payment help go into their savings
  - gifted stock, LLC shares and GRAT remainders land in a brokerage account with your cost basis
  - 529 money lands in a 529
  - a family loan arrives as cash, and its payments go out each year (net of forgiveness)
  - tuition and medical bills you pay are listed but not added (they cover costs the child would otherwise have)
  - their share of the inheritance, after estate tax and the heirs' IRA tax, arrives the year after your estate age, with a stepped-up basis
- **Simplification:** your side uses your plan's steady path. In the child's range of outcomes, their markets vary while your gifts stay as planned.
- **Storage:** one SQLite file per household (`household.sqlite` is yours; children's are `children/<n>.sqlite`), listed in a `family_household` table (migration 0009). Removing a child from your People page keeps their household, unlinked.

## Saving & restoring your data
Everything you enter can be saved to one **backup file** (`.fsim`) and opened again in this or any later version, on this Mac or another one. Use the **Save & load** page, or the File menu (⌘S / ⌘O).

- **What's in it:** every household (yours and your children's): people, accounts (including private-fund terms), income, debts, spending and one-time costs, assumptions, and every plan with its decisions, plus how each child household is linked. App settings (like the backup folder) aren't included. "Save just one household" makes a file with only the household on screen, for a child to send theirs.
- **Format** (`src-tauri/src/backup.rs`): JSON, `{ "format": "finance-simulator-backup", "formatVersion": 2, "appVersion", "savedAt", "households": [{ "name", "linkedTo", "household" }] }`, yours first. Version 1 files (a single `"household"`) open as one household. A plain backup opens in any text editor.
- **Password (optional):** the file is encrypted with **XChaCha20-Poly1305**, with the key derived from the password by **Argon2id** (19 MiB, 2 passes; the parameters are stored in the file). A wrong password or a damaged file is refused cleanly. A forgotten password can't be recovered.
- **Loading a backup** shows what's in it first (households, saved date, version, counts).
  - A family file replaces everything.
  - A one-household file can be loaded as everything, as your household, as a child's household (linked to them, replacing theirs if they have one), or as a new unlinked household. A file named after one of your children defaults to that child.
  - A **safety copy** of the whole family is saved first, and also before loading a demo, erasing, or deleting a child's household. Safety copies go to the backup folder if automatic backups are on, otherwise to "Safety copies" in the app's data folder.
- **Automatic backups** of the whole family (optional, to a folder you choose, such as iCloud Drive): written after changes (at most every 5 minutes) and when you quit. The newest 10 are kept (only files the app named are ever deleted). They have no password.
- **The compatibility promise:** a backup from any version opens in every later version.
  - New fields always have defaults (`#[serde(default)]`), and unknown fields are ignored.
  - Renames or restructures add a step to `upgrade()` in `backup.rs` and bump `formatVersion`.
  - The golden files in `fixtures/backups/` are never edited, and a test opens every one of them.
  - A file from a *newer* version gets a clear "please update the app" message.

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
