import { useState } from "react";
import { MoneyField, NumberField, PercentField, Row, SelectField, Toggle } from "../../components/fields";
import { Sheet } from "../../components/Sheet";
import type { TaxFacts } from "../../lib/api";
import { afrFor, afrMonthLabel, defaultLoan, eventTitle } from "../../lib/events";
import { formatPercent, formatUsd } from "../../lib/format";
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

  const done = () => {
    if ("to" in e && e.type !== "cash_gift" && !kids.some((c) => c.id === e.to)) {
      setError("Pick one of your children. Add them on the People page if they're missing.");
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
