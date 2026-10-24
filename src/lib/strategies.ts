// "Ways to pass money down": plain-language strategy cards for the Giving guide.
// Figures come from TaxFacts (engine/tax_tables) so the text matches what the app computes.
import type { TaxFacts } from "./api";
import { afrFor, afrMonthLabel } from "./events";
import { ageOf, giftableInKind, type Event, type Household } from "./types";

export type StrategyStatus = "in_app" | "coming";

export interface Strategy {
  id: string;
  title: string;
  status: StrategyStatus;
  /** When it's coming, which step builds it. */
  coming?: string;
  summary: string;
  how: string;
  pros: string[];
  cons: string[];
  /** What the app models for this strategy. */
  inApp: string;
  /** Pre-filled decisions for "Try this in a plan", or null if it needs nothing to try. */
  tryIt?: (h: Household, facts: TaxFacts) => { name: string; notes: string; events: Event[] } | null;
}

const money = (v: number) =>
  v >= 1e6 ? `$${Number((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`;

function nextAge(h: Household): number {
  const p = h.people.find((x) => x.role === "primary");
  return p ? ageOf(p) + 1 : 60;
}

function firstChild(h: Household) {
  return h.people.find((p) => p.role === "child") ?? null;
}

export function strategies(facts: TaxFacts): Strategy[] {
  const excl = money(facts.annualExclusion);
  const exemption = money(facts.exemption);
  return [
    {
      id: "annual",
      title: "Yearly tax-free gifts",
      status: "in_app",
      summary: `Give each child up to ${excl} a year (${facts.taxYear}; it rises with inflation) without using any lifetime exemption.`,
      how: `The yearly gift-tax exclusion lets you give up to ${excl} per person per year with no paperwork and no tax. Done every year, it moves a lot of money (and its future growth) out of your estate.`,
      pros: [
        "No gift tax and no exemption used",
        "Simple: cash, stock, or paying into an account for them",
        "Future growth on the gifts is out of your estate",
      ],
      cons: ["Only counts if done every year; unused years don't carry over", "Money is theirs to keep once given"],
      inApp:
        "Gift ledger, estate tax saved, and what each child ends up with. Use 'Give cash' with the yearly maximum.",
      tryIt: (h) =>
        firstChild(h)
          ? {
              name: "Yearly tax-free gifts",
              notes: "The yearly gift-tax exclusion to each child for 20 years.",
              events: [
                { type: "cash_gift", to: null, amount: 0, fromAge: nextAge(h), years: 20, maxAnnualExclusion: true },
              ],
            }
          : null,
    },
    {
      id: "home",
      title: "Help with a down payment",
      status: "in_app",
      summary: "A gift toward a child's home, optionally plus a family loan for part of the price.",
      how: `Anything above ${excl} in a year uses part of your lifetime exemption (no tax due unless it's used up). Pairing a smaller gift with a family loan spreads it out.`,
      pros: ["Helps when it matters most", "Can be combined with yearly gifts and a loan"],
      cons: [
        "Helping one child more than another makes totals uneven unless you balance it",
        "Large gifts use exemption",
      ],
      inApp: "Gift and loan cash flows, exemption used, and each child's total.",
      tryIt: (h) => {
        const c = firstChild(h);
        return c
          ? {
              name: `Help ${c.name} with a down payment`,
              notes: "Edit the amount and age.",
              events: [{ type: "home_help", to: c.id!, age: nextAge(h), gift: 100_000, loan: null }],
            }
          : null;
      },
    },
    {
      id: "loan",
      title: "Family loans",
      status: "in_app",
      summary: `Lend at the IRS minimum rate (${(afrFor(15, facts) * 100).toFixed(2)}% for 15 years in ${afrMonthLabel(facts)}) and optionally forgive some each year.`,
      how: `Your child pays you back with interest at the "applicable federal rate", far below most bank rates. Forgiving up to ${excl} a year of principal is a tax-free gift. Charging less than the AFR can count as a gift, so keep it at or above.`,
      pros: [
        "Cheaper for your child than a bank",
        "You keep getting paid back (interest is your taxable income)",
        "Forgiveness turns it into a gift gradually",
      ],
      cons: ["Needs a written note and real payments to hold up", "Your money is tied up until it's repaid"],
      inApp: "Repayments, taxable interest, forgiveness as gifts, and the loan counted in your estate until repaid.",
      tryIt: (h) => {
        const c = firstChild(h);
        return c
          ? {
              name: `Family loan to ${c.name}`,
              notes: "15-year loan at the IRS minimum rate, forgiving the yearly exclusion.",
              events: [
                {
                  type: "family_loan",
                  to: c.id!,
                  age: nextAge(h),
                  loan: {
                    amount: 300_000,
                    rate: afrFor(15, facts),
                    years: 15,
                    interestOnly: false,
                    forgivePerYear: facts.annualExclusion,
                  },
                },
              ],
            }
          : null;
      },
    },
    {
      id: "stock",
      title: "Give stock or investments",
      status: "in_app",
      summary:
        "Put shares in your kids' names. Their future growth leaves your estate, but your kids keep your cost basis.",
      how: "A gift of stock is valued at its market price that day (a stock split doesn't change that). The catch: your kids take your original cost basis and owe capital-gains tax when they sell, while stock you keep until death gets a stepped-up basis and that gain is never taxed. Often the better move is to give cash or high-basis shares and keep your lowest-basis shares.",
      pros: ["Moves future growth out of your estate", "No cash needed", "Can be done in yearly-exclusion amounts"],
      cons: [
        "Your kids lose the step-up in basis on what you give",
        "Low-basis stock is usually better kept until death",
      ],
      inApp:
        "Your basis travels with the gift; the kids' capital-gains tax (an assumed rate) is subtracted from what they receive.",
      tryIt: (h) => {
        const account = h.accounts.find((a) => giftableInKind(a.accountType));
        return firstChild(h) && account
          ? {
              name: "Give stock to the kids",
              notes: `From ${account.name}. Edit the amount.`,
              events: [{ type: "gift_assets", to: null, accountId: account.id!, age: nextAge(h), amount: 500_000 }],
            }
          : null;
      },
    },
    {
      id: "big",
      title: "A large gift now (use the exemption)",
      status: "in_app",
      summary: `Give a large amount now using part of your ${exemption} lifetime exemption, locking it in in case the law changes.`,
      how: "Gifts above the yearly exclusion use lifetime exemption, and no tax is due until it's used up. If the exemption is later cut, gifts already made under the higher amount stay sheltered (the IRS \"anti-clawback\" rule). Either way, a gift's future growth happens in your kids' hands, not your estate.",
      pros: ["Protects against a future cut in the exemption", "All later growth is outside your estate"],
      cons: [
        "You give up the money for good: check your own security first (see 'How much can you safely give?')",
        "Gifted assets lose the step-up in basis",
      ],
      inApp:
        "Exemption used, anti-clawback if you turn on the exemption-cut what-if, your odds, and each child's total.",
      tryIt: (h) =>
        firstChild(h)
          ? {
              name: "Large gift now",
              notes: "Check 'How much can you safely give?' for a safe size.",
              events: [
                {
                  type: "cash_gift",
                  to: null,
                  amount: 1_000_000,
                  fromAge: nextAge(h),
                  years: 1,
                  maxAnnualExclusion: false,
                },
              ],
            }
          : null,
    },
    {
      id: "roth",
      title: "Roth conversions",
      status: "in_app",
      summary: "Pay income tax now to move IRA money to a Roth, which your kids inherit tax-free.",
      how: "Converting traditional IRA money to a Roth is taxed as income this year. In return, required withdrawals shrink, your estate is smaller by the tax you paid (effectively a tax-free gift), and your kids inherit Roth money they can withdraw tax-free instead of taxable IRA money.",
      pros: [
        "Kids inherit tax-free money",
        "Smaller estate and smaller required withdrawals",
        "Locks in today's rates if you expect taxes to rise",
      ],
      cons: ["A big tax bill in the years you convert", "Higher income can raise Medicare premiums for two years"],
      inApp: "Conversion taxes, smaller RMDs, and lower heirs' income tax. Try it with the 'taxes rise' what-if on.",
      tryIt: (h) => {
        const age = nextAge(h);
        return {
          name: "Roth conversions",
          notes: "Convert some IRA money each year for five years.",
          events: [{ type: "roth_conversion", perYear: 200_000, fromAge: age, toAge: age + 4 }],
        };
      },
    },
    {
      id: "stepup",
      title: "Keep low-basis assets until death",
      status: "in_app",
      summary: "The step-up in basis erases capital-gains tax on what you hold until death.",
      how: "Your kids inherit assets at their value on the day of death, so decades of gains are never taxed. That makes your lowest-basis stock the best thing to keep, and cash or high-basis assets the best things to give.",
      pros: ["Wipes out capital-gains tax on inherited assets", "Nothing to do"],
      cons: ["Doesn't reduce estate tax: assets you keep are in your estate"],
      inApp: "Built into every estate result: inherited assets owe no capital-gains tax; gifts do.",
    },
    {
      id: "charity",
      title: "Give to charity",
      status: "coming",
      coming: "next update (5.2)",
      summary: "Gifts of cash or appreciated stock to a charity or donor-advised fund, and charitable bequests.",
      how: "Giving appreciated stock avoids its capital-gains tax and can be deducted at market value (within limits, if you itemize). A charitable bequest is deducted from the estate.",
      pros: ["Lowers income tax and estate tax", "Donor-advised funds let you give now and pick charities later"],
      cons: ["Money goes to charity, not family"],
      inApp: "Coming: charity decisions, itemized deductions under the 2026 rules, and charitable bequests.",
    },
    {
      id: "education",
      title: "529 plans, tuition & medical bills",
      status: "coming",
      coming: "next update (5.2)",
      summary: "Front-load five years of gifts into a 529, or pay tuition and medical bills directly with no limit.",
      how: "A 529 can take five years of yearly exclusions at once. Paying a school or medical provider directly doesn't count as a gift at all.",
      pros: ["Moves money out quickly", "Direct tuition and medical payments are unlimited and tax-free"],
      cons: ["529 money is meant for education", "Direct payments must go to the school or provider"],
      inApp: "Coming.",
    },
    {
      id: "llc",
      title: "Family LLC with a valuation discount",
      status: "coming",
      coming: "a later update (5.3)",
      summary:
        "Put assets in a family LLC and give shares, which are valued lower because they're hard to sell and don't control the LLC.",
      how: "Shares in a family LLC are often valued 20–35% below the assets inside, so each dollar of exemption moves more. The IRS scrutinizes these, so it needs an attorney and a real business purpose.",
      pros: ["Moves more value per dollar of exemption", "You can keep control as manager"],
      cons: ["Legal setup and upkeep", "IRS scrutiny"],
      inApp: "Coming.",
    },
    {
      id: "grat",
      title: "GRATs",
      status: "coming",
      coming: "a later update (5.3)",
      summary: "A trust that passes a fast-growing asset's growth above an IRS rate to your kids nearly tax-free.",
      how: "You put an asset (like a stock you expect to grow) in a trust that pays you back over a couple of years; anything it grows beyond the IRS rate goes to your kids, using little or no exemption.",
      pros: ["Moves upside with little exemption", "Low risk: if the asset falls, you just get it back"],
      cons: ["Needs an attorney", "If you die during the term, it's back in your estate"],
      inApp: "Coming.",
    },
  ];
}
