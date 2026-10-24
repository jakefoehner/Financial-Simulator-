# Finance Simulator — Spec & Build Plan

## Context
A local-first macOS app for running financial "what-if" scenarios with Monte Carlo forecasts and federal taxes built in. The main user is a **wealthy, retired, single mother (Texas)**. She is weighing whether to buy her kids houses, move assets into family LLCs, give inheritances early to cut future estate/gift taxes, and how much she can give away while still keeping a healthy income for herself. The second user is a 28-year-old with a lot of decisions still ahead. Each install holds one household. Friends can trade encrypted snapshot files by email and look at them in their own copy of the app. All data lives in local SQLite. Internet is used only for optional price and bank syncing.

## Stack
- **Tauri 2** (macOS-only target): an `.app` / `.dmg` of about 10MB.
- **Frontend:** React + TypeScript + Vite, Tailwind + Radix/shadcn-style components (clean, Apple-like look), Recharts for charts, Zustand for UI state.
- **Engine:** a pure Rust crate `engine/` with no Tauri dependencies, so it can be unit-tested on its own. It uses `rayon` to run simulation paths in parallel and `rand`/`rand_distr` (seeded, so runs are reproducible).
- **DB:** SQLite via `rusqlite` (bundled) plus `refinery` migrations, all on the Rust side. The frontend talks to it only through Tauri commands.
- **Tax law as data:** `engine/tax_tables/2026.json` (brackets, std deduction, LTCG thresholds, FICA wage base, IRMAA tiers, gift/estate exemption, RMD table, etc.). Future years are indexed by an inflation assumption. Updating each year means editing data, not code.

```
Finance_Simulator/
  engine/            # Rust lib: model, tax, projection, monte carlo, estate
    src/{model,tax,project,mc,estate,events}.rs
    tax_tables/2026.json
    data/historical_returns.csv   # annual stocks/bonds/bills/CPI 1928–present (Damodaran, attributed)
    tests/            # IRS worked-example tax tests + golden projection tests
  src-tauri/         # Tauri app: commands, db, migrations, share-file crypto
  src/               # React UI
  fixtures/          # demo households (JSON)
```

## Data model (SQLite)
- `household` (name, state, flat_state_rate, filing_status_timeline)
- `person` (name, birth_year, role: primary/spouse/dependent, life_expectancy default 100)
- `account`: type ∈ {checking, savings, taxable, trad_401k, roth_401k, trad_ira, roth_ira, hsa, 529, pension, real_estate, crypto, rsu, espp, options, llc_interest}; owner; balance; cost_basis; allocation (stocks/bonds/cash %); optional `holding` rows (ticker, shares, basis). In v1, holdings only add up to the balance and allocation. Each ticker is mapped to an asset class.
- `income_stream` (W-2, bonus, self-employment, rental, pension, annuity; start/end age; growth %)
- `social_security` (person, benefit estimated at full retirement age (FRA), claim age). The engine applies the early/delayed claiming adjustments.
- `debt` (mortgage, student loan incl. income-driven repayment (IDR)/forgiveness, auto, credit card; rate, term, balance)
- `expense` (annual base spending, inflation-adjusted) + `one_time_expense` (year, amount)
- `assumption_set` (return mode, means/vols/correlations, inflation, tax-indexing, sim count, seed)
- `scenario` (name, base_scenario_id, notes) + `scenario_event` (age/year, type, JSON params)
- `run_result` cache (scenario_id, assumptions hash, summary stats + percentile series)

## Scenario events (the "at age X, I do Y" timeline)
retire · claim_social_security · income_change · change_contribution · roth_conversion · buy_property (cash/mortgage, for self or **as a gift**) · sell_asset · gift_cash · gift_assets (carryover basis) · **intra_family_loan** (at the applicable federal rate (AFR), optional forgiveness schedule) · **transfer_to_llc** (fund an LLC, then gift interests with a user-set valuation discount %) · pay_off_debt / new_debt · one_time_expense · change_allocation / glide path · change_filing_status · death (an estate settles at that age).

Each scenario is a list of changes on top of the base plan. The UI shows scenarios side by side, plus a "difference vs base" view.

## Engine: yearly loop (per path)
1. Index tax tables and expenses for inflation. Age each person.
2. Income, plus Social Security based on claim age.
3. Pre-tax and Roth contributions, then required minimum distributions (RMDs) (SECURE 2.0 ages).
4. Apply this year's events (gifts, purchases, conversions, LLC moves).
5. Spending and debt payments. Withdraw to cover any shortfall in a configurable order (default: taxable → traditional → Roth). Taxes are solved by a fixed-point gross-up, because withdrawals create tax that requires more withdrawals.
6. Federal tax for the year (below). Gift tax ledger.
7. Apply returns per asset class. Track basis.
8. Record net worth, spendable income, portfolio yield, and the estate value if death occurred that year.

**Return modes** (revised 2026-10-23, see Decisions log):
- (a) **Steady path:** your Assumptions every year (default 7% stocks, 4% bonds, 2% cash, 3% real estate, 2.5% inflation). One deterministic path.
- (b) **Range of outcomes:** replayed real history, 1928–2025, in random 5-year runs. Each series is scaled so its compound average equals the Assumptions, and inflation is replayed too. Default 5,000 scenarios (1,000 / 5,000 / 10,000).

The parametric (made-up statistical returns) mode was dropped.

**Success metrics:**
- **Never runs out** (%): the portfolio covers spending through age 100 (or the chosen age).
- **Perpetual / "live off the income"** (%): in every year, spending ≤ dividends + interest + pensions/SS/annuities + rent. Equivalently, real portfolio value never falls below its starting real value. This is the headline number you asked for.
- Plus the 10th/50th/90th percentile net worth fan chart, a yearly cash-flow table, and value to heirs after estate tax. *Lifetime taxes paid is deliberately not shown.*
- A toggle switches between today's dollars and nominal dollars.

## Federal tax module (v1, current law, planning-grade)
Ordinary brackets · standard vs itemized deduction (mortgage interest, SALT incl. property tax with the current cap, charity) · LTCG/qualified dividends at 0/15/20, stacked on top of ordinary income · 3.8% net investment income tax (NIIT) · FICA + self-employment tax (with the ½ deduction) · simplified QBI · taxation of Social Security (provisional income) · RMDs · 10% early-withdrawal penalty (+ the age-55 rule) · Child Tax Credit · IRMAA (2-year lookback) · ACA premium tax credit (simplified) · simplified AMT · optional flat state rate · **gift tax** (annual exclusion per recipient, lifetime exemption used, Form 709 ledger) · **estate tax** (40% above the remaining exemption, step-up in basis for heirs vs carryover basis on gifts). This last item is the core trade-off behind your mom's "give it early vs at death" question.
Filing statuses: Single, Married Filing Jointly (MFJ), Married Filing Separately (MFS), Head of Household (HoH), changeable by year. Single is the main focus.
v2 hook: a "tax regime" setting that multiplies or replaces brackets and exemptions from year N on, for "what if taxes rise / the exemption is cut".

## UI (Apple-esque, no forced wizard)
- Sidebar: **Overview · People · Accounts · Income · Debts · Spending · Scenarios · Results · Settings**.
- On an empty install: a friendly checklist card ("Add yourself → add accounts → set spending"), plus a **"Load demo household"** button. Two demos: *Retired single mom, ~$X M* and *28-year-old early career*.
- Scenario builder: a horizontal age timeline. Click to add event cards, each with an inline form.
- Results: KPI tiles (perpetual %, never-runs-out %, median ending net worth, median heir value), a fan chart, a scenario comparison overlay, and the cash-flow table.

## Sharing, import/export
- **Backups (Phase 6, built):** see README "Saving & restoring your data" and the 2026-10-24 decision below. The read-only "Viewing" household, CSV and PDF below are later work.
- **`.fsim` share file:** a gzipped JSON snapshot of the household plus scenarios, encrypted with **XChaCha20-Poly1305**. The key comes from a passphrase via **Argon2id**. The file starts with a header (magic, version, KDF params, salt, nonce). You email the file and share the passphrase another way (text or phone call).
- An imported file opens as a separate **read-only "Viewing: <name>"** household, stored in its own SQLite file and deletable. Your own household is never mixed with it.
- CSV import (accounts/holdings, using a documented template plus mapping for common brokerage exports). CSV export of tables. PDF report export (rendered from the Results view).
- Optional DB encryption (SQLCipher plus a password at launch) is a later "peace of mind" setting.

## Connectivity (later phase)
- **Bank/brokerage sync:** Plaid needs a server holding secret keys, which doesn't fit a local app shared with friends. Use **SimpleFIN Bridge** instead. Each user pastes their own token (about $15/yr, paid by them), and the app pulls balances and holdings directly. No server of ours is involved.
- **Ticker prices:** a free quote API with a user-supplied key, or a manual refresh. Prices are cached locally.

## Phases (each ends in a working app)
0. **Scaffold:** git init, Tauri 2 + React/TS + Rust workspace, SQLite + migrations, a Tauri command round-trip, lint/format, `cargo test` + `vitest`.
1. **Data entry:** all tables and CRUD screens, manual input, demo households.
2. **Tax engine + fixed-return projection:** IRS worked-example tests. A single deterministic projection with charts and the cash-flow table.
3. **Range of outcomes:** centered historical replay, odds tiles, fan chart, zoom-in on rough/typical/strong/worst scenarios with the market history each replayed, an always-visible method note, real vs nominal toggle.
4. **Scenarios + estate/gifting** (mom's priority): decision timeline (home help, cash gifts, family loans, Roth conversions, spending, Social Security age), gift/estate ledger, exemption-cut what-if, "For the family" results, side-by-side comparison.
   4b. Family LLC with valuation discount, gifting investments in kind, selling property.
5. **Sharing & exports:** `.fsim` encrypt/import, CSV import/export, PDF report.
6. **Connectivity:** SimpleFIN sync, ticker prices, per-ticker holdings, and a **single-stock risk model**. Each individual stock's yearly return = that year's market return × its sensitivity to the market + a company-specific swing, estimated from its price history. Its expected return is not assumed to beat the market; the model adds risk, not extra return. This matters for low-basis positions in the Phase 4 gift-vs-hold decision.
7. **v2:** tax-rise regimes, optional DB encryption, more state-tax detail, stochastic lifespan, signed/notarized build.

## Decisions log
- **2026-10-23: How the range of outcomes works** (Jacob). Also shown in-app (Forecast → "How this works") and in the README.
  1. **Replay real history only** (1928–2025), no parametric mode. Crashes land wherever they fall in each scenario. Limitation: no year worse than 1931.
  2. **Centered on Assumptions:** `(1+r') = (1+r) × (1+target) / (1+historical geometric mean)`. Shape preserved (2008 −37% → about −38% at 7%). Setting stocks to 10% gives essentially unadjusted history. Why: forecasts for the coming decade are mostly below past averages, fees reduce returns, US history is a best case, and over-optimism is the costly error for gifting decisions.
  3. **5-year runs** of consecutive years keep slumps and inflation regimes intact.
  4. **Inflation follows history too**, centered on the inflation assumption. Optional "Keep inflation steady".
  5. **Single-stock risk deferred to Phase 6** (needs ticker data).
  6. **Range of outcomes is the default Forecast view**, with zoom-in on representative scenarios and their replayed history. The steady path stays one tab away.
- Success thresholds in the UI: "money lasts" is good at 90%+ and caution at 75–90%. "Lives off growth & income" (a stricter goal) is good at 75%+ and caution at 40–75%.
- **2026-10-23: Scenarios and estate** (Jacob). Mom is 58, retired, with an estate slightly above the $15M exemption.
  1. Priorities: down-payment help, cash gifts, family loans. Family LLC and in-kind gifts move to Phase 4b.
  2. The "exemption cut" what-if is pulled forward from v2: from a chosen year, the exemption becomes a set amount in today's dollars (default $7M from 2030).
  3. Heirs' income tax on inherited traditional IRA/401(k): 24% default, always disclosed on the "For the family" card, editable in Assumptions.
  4. Gifts are grown to the estate date at the household's own yearly portfolio return before being added to what each child receives, so early gifts are compared fairly with money kept.
  5. Scenario decisions are stored as JSON on the `scenario` row (one table instead of a separate events table).
  6. The demo "Retired in Texas" became 58 with about $16.5M and three example plans.
- **2026-10-24: Roadmap re-ordered around Mom's notes** (Jacob): scenarios are the priority.
  - Phase 5 = wealth transfer + private investments, in three steps:
    - 5.1: private funds and startups; gifting stock in kind; anti-clawback; tax-rise what-if; the "How much can I safely give?" solver; the Giving guide
    - 5.2: charity with itemized deductions; 529s; tuition and medical payments
    - 5.3: family LLC; GRATs
  - Sharing/exports moves to Phase 6, connectivity to Phase 7. Recipients are the two kids plus charities only.
  1. Private investments are separate account types with payout terms (yield on invested capital, taxable share, exit year and multiple, companies, QSBS), stored as JSON on the account. They're illiquid until exit.
  2. Startup outcomes per company: 55% nothing, 15% 0.5×, 10% 1×, 10% 3×, 7% 10×, 3% 30×, scaled to the user's expected multiple. Private credit: a 3%/yr chance of a 25% loss.
  3. Gifts carry cost basis. The kids' capital-gains tax on gift growth above basis is subtracted at an assumed 15% (editable).
  4. Anti-clawback: the estate exemption is the larger of the exemption at death and the gifts already sheltered. Gift tax also never re-taxes sheltered gifts.
  5. "Safe" in the solver = 95% chance the money lasts (adjustable 90/95/98). It uses common random numbers across trial amounts, searches with 1,000 scenarios, and is re-checked at the full count.
  6. Meta's Jan 2027 Class C share dividend was researched for Mom. Conclusion: a split doesn't change a gift's value; the reason to give stock is estate math, weighed against losing the step-up in basis.
- **2026-10-24: Phase 5.2 & 5.3** (charity, education, LLC, GRATs).
  1. Itemized deductions follow the 2025 One Big Beautiful Bill Act rules from 2026 (values in `tax_tables/2026.json`):
     - SALT cap $40,400 (+1%/yr to 2029, then $10,000), reduced 30% above $505,000 MAGI, floor $10,000
     - mortgage interest on up to $750k of home debt
     - charity: 0.5%-of-AGI floor; cash ≤60% and appreciated stock ≤30% of AGI; 5-year carryforward with this year's gifts used first; carryovers used up whether or not you itemize
     - the 2/37 haircut caps top-bracket benefit at 35%
     - $1,000/$2,000 for non-itemizers (cash to public charities, not donor-advised funds)
     - State income tax for SALT is estimated as the flat rate × (AGI − standard deduction).
  2. The gift ledger is separate from what each child receives:
     - tuition and medical paid directly: received, never reported
     - 529 superfunding: one-fifth a year, with the unspread part pulled back into the estate
     - LLC shares: reported at the discount
     - GRAT remainders: reported as $0 (zeroed-out GRAT)
     - 529 growth is tax-free for the kids.
  3. Family LLC: a non-spendable holding invested like its source account, taxed to the owner. The yearly gift share is of the whole LLC, split evenly. The owner's remaining share is discounted in the estate only at ≤50% ownership (no control). The IRS-risk caveat is shown in the form, the guide and the README.
  4. GRATs: level annuity at the §7520 rate (6.20%, Nov 2026, held constant), paid at each anniversary. Rolling puts every payment into a new GRAT of the same term until the chosen age. Assets during a term stay in the estate (mortality risk). On the steady path the demo's mixed portfolio doesn't beat 6.2%, so GRATs show their value in the range of outcomes; Compare adds a 9-in-10 "strong markets" row when a plan has one.
  5. Charitable bequest = a share of the gross estate, deducted before estate tax; optionally taken from traditional IRA money first.
  6. New inputs: household home property tax and a "home mortgage" flag on debts (migration 0007).
- **2026-10-24: Phase 6 = save & restore** (Jacob). Mom's data takes a while to enter, so it must be saved and reloaded in all future versions.
  1. One `.fsim` backup file (JSON envelope with `formatVersion`) instead of CSV, since plans hold nested decisions.
  2. The password is optional (XChaCha20-Poly1305 + Argon2id), off by default.
  3. Automatic backups go to a chosen folder: after changes (at most every 5 minutes) and at quit, keeping 10, with no password. They're stored in a new `app_settings` table (migration 0008), outside the household.
  4. Opening a backup replaces the household after a confirmation and a safety copy. Read-only viewing of someone else's file, CSV import/export and the PDF report are deferred.
  5. Compatibility: additive fields default; renames go through `upgrade()`; golden files in `fixtures/backups/` must always open; newer files get an "update the app" message. Version bumped to 0.5.0.
- **2026-10-24: Phase 7 = family households** (Jacob). Children must be "fully buildable, the same way the main person is", and the backup page has to be easy to find.
  1. Each child gets a full household (every page, including plans and a forecast) in its own SQLite file. The main file lists them in `family_household` (migration 0009). The UI calls them "households", since "plans" already means what-if scenarios.
  2. **Linked:** the child household picks one of the parent's plans. Its `transfers_by_child` and the estate's per-child inheritance become `Household.incoming`, computed at run time and never stored. Projection applies it: cash and the inheritance go to savings, assets keep the parent's basis, 529 money goes to a 529, loans arrive as cash with payments out. The parent side uses its steady path.
  3. Anyone can build a child's household and share it. A one-household backup can be loaded as a specific child.
  4. Backup format v2: a list of households with their links; v1 opens as one household. New golden files `v2-family*.fsim`.
  5. A "Save & load" page in the sidebar replaces the Settings card, with a household list (open/delete) and automatic backups (which save the whole family).
  6. Next: Phase 8 (search on Scenarios, the decision picker and the Giving guide).
- **2026-10-24: Phase 8 = search** (Jacob): "make the scenarios and giving all searchable so we don't have to scroll as we add more."
  1. One matcher (`src/lib/search.ts`): all words must match, money normalized, a small synonym table.
  2. Scenarios: search plus sort (newest / A–Z / most for the kids), cards or a compact list, and a sticky compare bar.
  3. Decision picker: search with keywords per decision (`CHOICE_KEYWORDS`); Enter picks the first match.
  4. Giving guide: search, tag chips (`Strategy.tags`), collapsed cards, and an "On this page" list.
- **2026-10-24: Phase 9 = data in and out** (Jacob).
  1. Brokerage import for Schwab, Fidelity, Vanguard, Merrill and Morgan Stanley, plus a template, with a column-mapping fallback. One parser keyed on column-name aliases instead of five separate ones. Test files are synthetic, modeled on each export's published layout.
  2. Positions are a JSON `holdings` column on the account (like `private_terms`), not a separate table: simpler, and they travel in backups.
  3. Read-only viewing swaps in a temporary `Family` and refuses edits in `mutate`, `replace_all` and the household commands.
  4. CSV exports, and a print-styled Report page saved as PDF through the native print panel (`WebviewWindow::print`).

## Verification
- `cargo test -p engine`: tax tests against IRS worked examples and hand-computed cases (brackets, LTCG stacking, SS taxability, NIIT, RMD, gift/estate exemption). Golden-file projections for the demo households. Monte Carlo sanity checks: with zero volatility the result must equal the fixed-mode output, and a fixed seed must be reproducible.
- `vitest` for UI logic. Manual run with `npm run tauri dev`. Load the demo, build a "gift house to daughter at 70" scenario, and confirm the gift ledger, the reduced estate tax, and the perpetual % change.
- Round-trip test: export `.fsim` → import with the passphrase → identical snapshot. A wrong passphrase fails cleanly.
- Distribution note: an unsigned `.dmg` triggers a Gatekeeper warning (right-click → Open). Signing and notarizing requires an Apple Developer account ($99/yr). Deferred to v2.
