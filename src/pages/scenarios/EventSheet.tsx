import { useState } from "react";
import { MoneyField, NumberField, PercentField, Row, SelectField, Toggle } from "../../components/fields";
import { Sheet } from "../../components/Sheet";
import type { TaxFacts } from "../../lib/api";
import { afrFor, afrMonthLabel, defaultLoan, eventTitle } from "../../lib/events";
import { formatPercent, formatUsd, formatUsdCompact } from "../../lib/format";
import type { Account, Event, Id, LoanTerms, Person } from "../../lib/types";

const CLAIM_AGES = [62, 63, 64, 65, 66, 67, 68, 69, 70];

/** Create/edit one decision. Changes stay in the plan's draft until the plan is saved. */
export function EventSheet({
  initial,
  isNew,
  kids,
  giftAccounts,
  facts,
  onDone,
  onRemove,
  onCancel,
}: {
  initial: Event;
  isNew: boolean;
  kids: Person[];
  giftAccounts: Account[];
  facts: TaxFacts;
  onDone: (e: Event) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [e, setE] = useState<Event>(initial);
  const [error, setError] = useState<string | null>(null);
  // Each form edits one variant; this keeps the variant's type while updating fields.
  const patch = <T extends Event>(p: Partial<T>) => setE((cur) => ({ ...cur, ...p }) as Event);

  const childOptions = kids.map((c) => ({ value: c.id!, label: c.name }));
  const exclusion = formatUsd(facts.annualExclusion);

  const accountOptions = giftAccounts.map((a) => ({ value: a.id!, label: a.name }));
  const noGiftAccounts = (
    <p className="text-sm text-[var(--muted)]">
      Add a brokerage or stock account on the Accounts page first; this works with investments you can move in kind.
    </p>
  );

  const done = () => {
    if ("to" in e && e.type !== "cash_gift" && e.to != null && !kids.some((c) => c.id === e.to)) {
      setError("Pick one of your children. Add them on the People page if they're missing.");
      return;
    }
    if ((e.type === "family_llc" || e.type === "grat") && kids.length === 0) {
      setError("Add your children on the People page first.");
      return;
    }
    if ((e.type === "family_llc" || e.type === "grat") && !giftAccounts.some((a) => a.id === e.accountId)) {
      setError("Pick a brokerage or stock account to move into it.");
      return;
    }
    onDone(e);
  };

  return (
    <Sheet
      title={isNew ? eventTitle(e.type) : `Edit: ${eventTitle(e.type).toLowerCase()}`}
      error={error}
      saving={false}
      onSave={done}
      onCancel={onCancel}
      onDelete={onRemove}
      deleteLabel="Remove"
      saveLabel="Done"
      deleteWarning="Remove this decision from the plan?"
    >
      {e.type === "home_help" && (
        <>
          <Row>
            <SelectField<Id> label="Which child" value={e.to} onChange={(to) => patch({ to })} options={childOptions} />
            <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
          </Row>
          <MoneyField
            label="Down-payment gift"
            hint={`Gifts above ${exclusion} a year per child use part of your lifetime exemption (no tax is due until it's used up).`}
            value={e.gift}
            onChange={(v) => patch({ gift: v ?? 0 })}
          />
          <Toggle
            label="Also lend part of the price"
            hint="A family loan instead of (or alongside) a bank mortgage."
            checked={e.loan != null}
            onChange={(on) => patch({ loan: on ? defaultLoan(facts) : null })}
          />
          {e.loan && <LoanFields loan={e.loan} facts={facts} onChange={(loan) => patch({ loan })} />}
        </>
      )}

      {e.type === "cash_gift" && (
        <>
          <Row>
            <SelectField<Id>
              label="To"
              value={e.to ?? 0}
              onChange={(v) => patch({ to: v === 0 ? null : v })}
              options={[{ value: 0, label: "Each child" }, ...childOptions]}
            />
            <NumberField
              label="Starting at your age"
              value={e.fromAge}
              onChange={(v) => patch({ fromAge: v ?? e.fromAge })}
            />
          </Row>
          <Toggle
            label="Give the yearly gift-tax maximum"
            hint={`${exclusion} per child in ${facts.taxYear}, rising with inflation. Gifts up to this amount don't use your lifetime exemption.`}
            checked={e.maxAnnualExclusion}
            onChange={(maxAnnualExclusion) => patch({ maxAnnualExclusion })}
          />
          <Row>
            {!e.maxAnnualExclusion && (
              <MoneyField label="Amount each time" value={e.amount} onChange={(v) => patch({ amount: v ?? 0 })} />
            )}
            <NumberField
              label="For how many years"
              hint="1 means a one-time gift."
              value={e.years}
              onChange={(v) => patch({ years: Math.max(1, v ?? 1) })}
            />
          </Row>
        </>
      )}

      {e.type === "give_mix" && (
        <>
          <Row>
            <SelectField<Id>
              label="To"
              value={e.to ?? 0}
              onChange={(v) => patch({ to: v === 0 ? null : v })}
              options={[{ value: 0, label: "Each child" }, ...childOptions]}
            />
            <MoneyField
              label={e.to == null ? "Amount to each child" : "Amount"}
              value={e.amount}
              onChange={(v) => patch({ amount: v ?? 0 })}
            />
          </Row>
          <Row>
            <NumberField
              label="First gift at your age"
              value={e.fromAge}
              onChange={(v) => patch({ fromAge: v ?? e.fromAge, untilAge: Math.max(e.untilAge, v ?? e.fromAge) })}
            />
            <SelectField<number>
              label="Repeat"
              value={e.everyYears}
              onChange={(everyYears) => patch({ everyYears })}
              options={[
                { value: 0, label: "Just once" },
                ...[2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: n, label: `Every ${n} years` })),
              ]}
            />
          </Row>
          {e.everyYears > 0 && (
            <NumberField
              label="Last gift no later than your age"
              value={e.untilAge}
              onChange={(v) => patch({ untilAge: Math.max(e.fromAge, v ?? e.untilAge) })}
            />
          )}
          <Toggle
            label="Only if my savings hold up"
            hint="“If the world continues to be kind to us”: a gift is skipped in any year your spendable savings (cash, brokerage, retirement accounts, in today's dollars) are below the amount you set."
            checked={e.minSavings != null}
            onChange={(on) => patch({ minSavings: on ? 10_000_000 : null })}
          />
          {e.minSavings != null && (
            <MoneyField
              label="Give only while my savings are at least"
              value={e.minSavings}
              onChange={(v) => patch({ minSavings: v ?? 0 })}
            />
          )}
          <div className="grid gap-3 rounded-lg border border-[var(--border)] p-4">
            <p className="text-xs font-medium text-[var(--muted)]">What each gift is made of</p>
            <Row>
              <PercentField
                label="In stocks"
                decimals={0}
                value={e.stocksShare}
                onChange={(v) => patch({ stocksShare: Math.min(1, Math.max(0, v)) })}
              />
              <PercentField
                label="Income funds pay per year"
                hint={`The other ${Math.round((1 - e.stocksShare) * 100)}%, e.g. Evergreen (~7%) and Cliffwater (~10%): about 8.5% on average.`}
                value={e.incomeYield}
                onChange={(v) => patch({ incomeYield: Math.min(0.25, Math.max(0, v)) })}
              />
            </Row>
            <Toggle
              label="Reinvest the income funds' payouts"
              hint="Off: your kids receive the payouts as cash (taxed as income). On: they stay in the fund and it grows (still taxed each year)."
              checked={e.reinvestIncome}
              onChange={(reinvestIncome) => patch({ reinvestIncome })}
            />
          </div>
          <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
            Each gift is paid from your savings and counts against your lifetime exemption above the {exclusion} yearly
            exclusion (keep giving that separately in "Gifts you already give"). In the range of outcomes, gifts that
            fall below your savings line are skipped, so the forecast shows how often they happen. In a child's own
            household (linked to yours), the stocks arrive in a brokerage account and the income funds as a fund paying
            its yearly rate.
          </p>
        </>
      )}

      {e.type === "family_loan" && (
        <>
          <Row>
            <SelectField<Id> label="Which child" value={e.to} onChange={(to) => patch({ to })} options={childOptions} />
            <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
          </Row>
          <LoanFields loan={e.loan} facts={facts} onChange={(loan) => patch({ loan })} />
        </>
      )}

      {e.type === "gift_assets" && (
        <>
          <Row>
            <SelectField<Id>
              label="To"
              value={e.to ?? 0}
              onChange={(v) => patch({ to: v === 0 ? null : v })}
              options={[{ value: 0, label: "Each child" }, ...childOptions]}
            />
            <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
          </Row>
          <Row>
            <SelectField<Id>
              label="From account"
              value={e.accountId}
              onChange={(accountId) => patch({ accountId })}
              options={giftAccounts.map((a) => ({ value: a.id!, label: a.name }))}
            />
            <MoneyField
              label={e.to == null ? "Market value to each child" : "Market value to give"}
              value={e.amount}
              onChange={(v) => patch({ amount: v ?? 0 })}
            />
          </Row>
          <GiftBasisHint account={giftAccounts.find((a) => a.id === e.accountId)} exclusion={exclusion} />
        </>
      )}

      {e.type === "roth_conversion" && (
        <>
          <MoneyField
            label="Convert per year"
            hint="Taxed as income in the year you convert. In return, later required withdrawals shrink, and your kids inherit tax-free Roth money instead of taxable IRA money."
            value={e.perYear}
            onChange={(v) => patch({ perYear: v ?? 0 })}
          />
          <Row>
            <NumberField label="From your age" value={e.fromAge} onChange={(v) => patch({ fromAge: v ?? e.fromAge })} />
            <NumberField label="Through your age" value={e.toAge} onChange={(v) => patch({ toAge: v ?? e.toAge })} />
          </Row>
        </>
      )}

      {e.type === "spending_change" && (
        <Row>
          <NumberField label="From your age" value={e.fromAge} onChange={(v) => patch({ fromAge: v ?? e.fromAge })} />
          <MoneyField
            label="Yearly spending (today's dollars)"
            value={e.annualAmount}
            onChange={(v) => patch({ annualAmount: v ?? 0 })}
          />
        </Row>
      )}

      {e.type === "fund529" && (
        <>
          <Row>
            <SelectField<Id>
              label="For which child"
              value={e.to}
              onChange={(to) => patch({ to })}
              options={childOptions}
            />
            <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
          </Row>
          <MoneyField label="Amount" value={e.amount} onChange={(v) => patch({ amount: v ?? 0 })} />
          <Toggle
            label="Spread it over five years (superfunding)"
            hint={`Counts up to ${formatUsd(5 * facts.annualExclusion)} as five years of ${exclusion} yearly gifts, so it uses none of your lifetime exemption. You'd skip other gifts to this child for those years. If you die within the five years, part of it is counted back in your estate.`}
            checked={e.superfund}
            onChange={(superfund) => patch({ superfund })}
          />
          <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
            Growth is tax-free when spent on school (the app assumes it is). You stay the owner and can change the
            beneficiary to another family member, including a grandchild later.
          </p>
        </>
      )}

      {e.type === "pay_tuition_medical" && (
        <>
          <Row>
            <SelectField<Id>
              label="For which child"
              value={e.to}
              onChange={(to) => patch({ to })}
              options={childOptions}
            />
            <NumberField
              label="Starting at your age"
              value={e.fromAge}
              onChange={(v) => patch({ fromAge: v ?? e.fromAge })}
            />
          </Row>
          <Row>
            <MoneyField label="Amount per year" value={e.amount} onChange={(v) => patch({ amount: v ?? 0 })} />
            <NumberField
              label="For how many years"
              value={e.years}
              onChange={(v) => patch({ years: Math.max(1, v ?? 1) })}
            />
          </Row>
          <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
            Pay the school or medical provider directly, not your child. Then it isn't a gift at all: no limit, no
            exemption used, and you can still give the yearly {exclusion} on top. Tuition only (not room, board or
            books); medical includes health insurance premiums.
          </p>
        </>
      )}

      {e.type === "charity_gift" && (
        <>
          <Row>
            <MoneyField
              label={e.years > 1 ? "Amount per year" : "Amount"}
              value={e.amount}
              onChange={(v) => patch({ amount: v ?? 0 })}
            />
            <NumberField
              label="Starting at your age"
              value={e.fromAge}
              onChange={(v) => patch({ fromAge: v ?? e.fromAge })}
            />
          </Row>
          <Row>
            <NumberField
              label="For how many years"
              hint="1 means a one-time gift."
              value={e.years}
              onChange={(v) => patch({ years: Math.max(1, v ?? 1) })}
            />
            <SelectField<Id>
              label="Give"
              value={e.accountId ?? 0}
              onChange={(v) => patch({ accountId: v === 0 ? null : v })}
              options={[
                { value: 0, label: "Cash" },
                ...giftAccounts.map((a) => ({ value: a.id!, label: `Stock from ${a.name}` })),
              ]}
            />
          </Row>
          <Toggle
            label="Through a donor-advised fund"
            hint="Get the deduction now and recommend grants to charities later. Putting several years of giving in at once helps you itemize."
            checked={e.donorAdvised}
            onChange={(donorAdvised) => patch({ donorAdvised })}
          />
          <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
            {e.accountId != null
              ? "Giving appreciated stock (owned over a year) avoids the capital-gains tax and is deductible at full market value, up to 30% of your income a year. "
              : "Cash is deductible up to 60% of your income a year. "}
            Anything above the limit carries forward up to five years. From {facts.taxYear}, only giving above 0.5% of
            your income counts if you itemize; if you don't, up to $1,000 of cash given straight to charities (not a
            donor-advised fund) is still deductible.
          </p>
        </>
      )}

      {e.type === "charitable_bequest" && (
        <>
          <PercentField
            label="Share of your estate to charity"
            value={e.share}
            onChange={(share) => patch({ share: Math.min(1, Math.max(0, share)) })}
          />
          <Toggle
            label="Leave IRA money to charity first"
            hint="Charities pay no income tax on IRA money, but your kids would. Naming a charity as an IRA beneficiary is usually the most tax-efficient way to give at death."
            checked={e.fromIraFirst}
            onChange={(fromIraFirst) => patch({ fromIraFirst })}
          />
          <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
            Everything left to charity is deducted before estate tax, so on an estate above the exemption each dollar
            given costs your kids about 60 cents.
          </p>
        </>
      )}

      {e.type === "family_llc" &&
        (giftAccounts.length === 0 ? (
          noGiftAccounts
        ) : (
          <>
            <Row>
              <SelectField<Id>
                label="Move investments from"
                value={e.accountId}
                onChange={(accountId) => patch({ accountId })}
                options={accountOptions}
              />
              <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
            </Row>
            <MoneyField label="Amount to put in the LLC" value={e.amount} onChange={(v) => patch({ amount: v ?? 0 })} />
            <Row>
              <PercentField
                label="Share of the LLC to give each year"
                hint="Split evenly between your kids."
                value={e.giftShare}
                onChange={(giftShare) => patch({ giftShare: Math.min(1, Math.max(0, giftShare)) })}
              />
              <NumberField
                label="For how many years"
                value={e.years}
                onChange={(v) => patch({ years: Math.max(1, v ?? 1) })}
              />
            </Row>
            <PercentField
              label="Valuation discount"
              hint="Because LLC shares can't be sold easily or control anything, an appraiser values them below their share of the assets. 20–35% is typical."
              value={e.discount}
              onChange={(discount) => patch({ discount: Math.min(0.6, Math.max(0, discount)) })}
            />
            <LlcHint e={e} kids={kids.length} exclusion={facts.annualExclusion} />
          </>
        ))}

      {e.type === "grat" &&
        (giftAccounts.length === 0 ? (
          noGiftAccounts
        ) : (
          <>
            <Row>
              <SelectField<Id>
                label="Move investments from"
                value={e.accountId}
                onChange={(accountId) => patch({ accountId })}
                options={accountOptions}
              />
              <NumberField label="At your age" value={e.age} onChange={(v) => patch({ age: v ?? e.age })} />
            </Row>
            <Row>
              <MoneyField label="Amount" value={e.amount} onChange={(v) => patch({ amount: v ?? 0 })} />
              <NumberField
                label="Length (years)"
                value={e.termYears}
                onChange={(v) => patch({ termYears: Math.min(20, Math.max(2, v ?? 2)) })}
              />
            </Row>
            <Toggle
              label="Keep rolling"
              hint="Each payment back to you starts a new GRAT, so more of the growth keeps moving to the kids."
              checked={e.rolling}
              onChange={(rolling) => patch({ rolling })}
            />
            {e.rolling && (
              <NumberField
                label="Start the last one at your age"
                value={e.untilAge}
                onChange={(v) => patch({ untilAge: Math.max(e.age, v ?? e.untilAge) })}
              />
            )}
            <GratHint e={e} rate={facts.section7520} month={afrMonthLabel(facts)} />
          </>
        ))}

      {e.type === "social_security_age" && (
        <SelectField<number>
          label="Start Social Security at"
          hint="Overrides the age set on the Income page, for this plan only."
          value={e.age}
          onChange={(age) => patch({ age })}
          options={CLAIM_AGES.map((a) => ({ value: a, label: a === 67 ? "67 (full retirement age)" : String(a) }))}
        />
      )}
    </Sheet>
  );
}

/** What the LLC gifts are worth and how they're reported, plus the IRS caveat. */
function LlcHint({
  e,
  kids,
  exclusion,
}: {
  e: Extract<Event, { type: "family_llc" }>;
  kids: number;
  exclusion: number;
}) {
  const value = e.amount * e.giftShare;
  const reported = (value * (1 - e.discount)) / Math.max(1, kids);
  return (
    <div className="grid gap-1 rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
      <p>
        The first year your kids receive about {formatUsdCompact(value)} of LLC shares, reported as{" "}
        {formatUsdCompact(reported)} each
        {reported > exclusion
          ? ` (above the ${formatUsd(exclusion)} yearly exclusion, so part uses your exemption)`
          : ""}
        . Once you own half or less, your own share is valued at the discount in your estate too. You keep managing the
        investments; the LLC's income is still taxed to you.
      </p>
      <p>
        The IRS challenges discounts that look aggressive. It needs a real purpose beyond taxes, a qualified appraisal,
        and LLC formalities kept up. Set it up with an estate attorney.
      </p>
    </div>
  );
}

/** The GRAT's yearly payment back and what it takes to pass anything to the kids. */
function GratHint({ e, rate, month }: { e: Extract<Event, { type: "grat" }>; rate: number; month: string }) {
  const n = Math.max(1, e.termYears);
  const annuity = rate === 0 ? e.amount / n : (e.amount * rate) / (1 - (1 + rate) ** -n);
  return (
    <div className="grid gap-1 rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
      <p>
        You're paid back {formatUsdCompact(annuity)} a year for {n} years: what you put in plus interest at the IRS
        §7520 rate ({formatPercent(rate)}, {month}). So the gift is valued at about $0 and uses none of your exemption.
      </p>
      <p>
        Whatever the investments earn above {formatPercent(rate)} goes to your kids at the end. If they earn less,
        everything comes back to you and you've lost nothing but the setup cost. If you die during the term, the GRAT is
        counted back in your estate. Short terms on volatile stock tend to work best.
      </p>
    </div>
  );
}

/** Explains the cost-basis trade-off for the chosen account. */
function GiftBasisHint({ account, exclusion }: { account: Account | undefined; exclusion: string }) {
  if (!account) return null;
  const gainShare =
    account.costBasis != null && account.balance > 0 ? Math.max(0, 1 - account.costBasis / account.balance) : null;
  return (
    <div className="grid gap-1 rounded-lg bg-accent/5 px-3 py-2 text-xs text-[var(--muted)]">
      <p>
        Your kids keep your original cost basis.{" "}
        {gainShare != null
          ? `About ${Math.round(gainShare * 100)}% of what you give from ${account.name} is gain they'd pay capital-gains tax on when they sell.`
          : "Add the account's cost basis to see how much would be taxable gain."}{" "}
        If you kept it instead, that gain would be wiped out at death (the step-up in basis).
      </p>
      <p>
        Gifts above {exclusion} a year per child use part of your lifetime exemption. A stock split doesn't change a
        gift's value.
      </p>
    </div>
  );
}

function LoanFields({ loan, facts, onChange }: { loan: LoanTerms; facts: TaxFacts; onChange: (l: LoanTerms) => void }) {
  const set = (p: Partial<LoanTerms>) => onChange({ ...loan, ...p });
  const afr = afrFor(loan.years, facts);
  const month = afrMonthLabel(facts);
  return (
    <div className="grid gap-4 rounded-lg border border-[var(--border)] p-4">
      <Row>
        <MoneyField label="Loan amount" value={loan.amount} onChange={(v) => set({ amount: v ?? 0 })} />
        <NumberField
          label="Paid back over (years)"
          value={loan.years}
          onChange={(v) => {
            const years = Math.min(40, Math.max(1, v ?? loan.years));
            // Keep the rate at the IRS minimum if it was there.
            const atMinimum = Math.abs(loan.rate - afr) < 1e-9;
            set({ years, rate: atMinimum ? afrFor(years, facts) : loan.rate });
          }}
        />
      </Row>
      <Row>
        <PercentField
          label="Interest rate"
          hint={`IRS minimum for ${loan.years} years (${month}): ${formatPercent(afr)}. Charging less can count as a gift.`}
          value={loan.rate}
          onChange={(rate) => set({ rate })}
        />
        <MoneyField
          label="Forgive per year"
          hint={`Forgiven principal is a gift. Up to ${formatUsd(facts.annualExclusion)} a year stays within the yearly exclusion.`}
          value={loan.forgivePerYear}
          onChange={(v) => set({ forgivePerYear: v ?? 0 })}
        />
      </Row>
      <Toggle
        label="Interest only"
        hint="Your child pays only interest each year and the full amount at the end."
        checked={loan.interestOnly}
        onChange={(interestOnly) => set({ interestOnly })}
      />
    </div>
  );
}
