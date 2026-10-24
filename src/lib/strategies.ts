// "Ways to pass money down": plain-language strategy cards for the Giving guide.
// Figures come from TaxFacts (engine/tax_tables) so the text matches what the app computes.
import type { TaxFacts } from "./api";
import { afrFor, afrMonthLabel } from "./events";
import { ageOf, giftableInKind, type Event, type Household } from "./types";

export type StrategyStatus = "in_app" | "coming";

export type StrategyTag = "kids" | "charity" | "advanced" | "taxes";

export const STRATEGY_TAGS: { id: StrategyTag; label: string }[] = [
  { id: "kids", label: "For the kids" },
  { id: "charity", label: "Charity" },
  { id: "advanced", label: "Advanced" },
  { id: "taxes", label: "Taxes" },
];

export interface Strategy {
  id: string;
  title: string;
  /** For the guide's filter chips. */
  tags: StrategyTag[];
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
      tags: ["kids"],
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
      tags: ["kids"],
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
      tags: ["kids"],
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
      tags: ["kids", "taxes"],
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
        "Your basis travels with the gift; the kids' capital-gains tax (an assumed rate) is subtracted from what they receive. If you list the shares as positions on your account, a single stock's own ups and downs (from its price history) show in the range of outcomes, so you can compare giving a volatile, low-basis stock with keeping it.",
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
      tags: ["kids", "taxes"],
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
      tags: ["taxes"],
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
      tags: ["kids", "taxes"],
      title: "Keep low-basis assets until death",
      status: "in_app",
      summary: "The step-up in basis erases capital-gains tax on what you hold until death.",
      how: "Your kids inherit assets at their value on the day of death, so decades of gains are never taxed. That makes your lowest-basis stock the best thing to keep, and cash or high-basis assets the best things to give.",
      pros: ["Wipes out capital-gains tax on inherited assets", "Nothing to do"],
      cons: ["Doesn't reduce estate tax: assets you keep are in your estate"],
      inApp: "Built into every estate result: inherited assets owe no capital-gains tax; gifts do.",
    },
    {
      id: "education",
      tags: ["kids"],
      title: "529 plans, tuition & medical bills",
      status: "in_app",
      summary: `Front-load five years of gifts (${money(5 * facts.annualExclusion)} per child) into a 529, or pay tuition and medical bills directly with no limit at all.`,
      how: `A 529 grows tax-free for school, and you can count up to five years of the ${excl} yearly exclusion at once ("superfunding"), so it uses no lifetime exemption. You stay the owner and can switch the beneficiary within the family. Separately, tuition or medical bills you pay straight to the school or provider aren't gifts at all: no limit, and you can still give the yearly ${excl} on top.`,
      pros: [
        "Moves money and its growth out of your estate quickly",
        "Direct tuition and medical payments are unlimited and use no exemption",
        "529 growth is tax-free for education; the beneficiary can change",
      ],
      cons: [
        "529 money is meant for education (other uses owe tax and a 10% penalty on earnings)",
        "Superfunding uses up five years of yearly gifts to that child",
        "Direct payments must go to the school or provider, and only tuition counts (not room and board)",
      ],
      inApp:
        "The 529 is spread over five years in the gift ledger (pulled back into the estate if you die within them) and grows tax-free in each child's total. Tuition and medical payments count toward what the child receives but never toward the gift ledger.",
      tryIt: (h) => {
        const kids = h.people.filter((p) => p.role === "child");
        if (kids.length === 0) return null;
        const age = nextAge(h);
        return {
          name: "529s and tuition",
          notes: "A superfunded 529 for each child, plus four years of tuition paid directly. Edit the amounts.",
          events: [
            ...kids.map((k): Event => ({
              type: "fund529",
              to: k.id!,
              age,
              amount: 5 * facts.annualExclusion,
              superfund: true,
            })),
            { type: "pay_tuition_medical", to: kids[0].id!, amount: 60_000, fromAge: age, years: 4 },
          ],
        };
      },
    },
    {
      id: "charity",
      tags: ["charity", "taxes"],
      title: "Give to charity",
      status: "in_app",
      summary:
        "Give cash or appreciated stock to a charity or donor-advised fund, or leave part of your estate to charity.",
      how: "Giving stock you've owned over a year avoids its capital-gains tax and is deductible at full market value (up to 30% of your income a year; cash up to 60%, with the rest carried forward five years). From 2026 only giving above 0.5% of your income counts if you itemize, and top-bracket deductions are worth 35 cents per dollar. A donor-advised fund lets you take the deduction now, bunching several years so itemizing pays off, and pick charities later. A charitable bequest is deducted from the estate, and IRA money is the best thing to leave, since a charity owes no income tax on it but your kids would.",
      pros: [
        "Lowers income tax now and estate tax later",
        "Appreciated stock avoids capital-gains tax entirely",
        "A donor-advised fund separates the tax deduction from choosing charities",
      ],
      cons: ["Money goes to charity, not family", "Deductions only help if you itemize (beyond a small $1,000 amount)"],
      inApp:
        "Itemized deductions (property tax under the SALT cap, mortgage interest, charity with its limits, floor and carryforward) versus the standard deduction each year, and charitable bequests in the estate, from IRA money first if you choose.",
      tryIt: (h) => {
        const account = h.accounts.find((a) => giftableInKind(a.accountType));
        const age = nextAge(h);
        return {
          name: "Give to charity",
          notes: account
            ? `Appreciated stock from ${account.name} to a donor-advised fund for five years, and 10% of the estate to charity from IRA money.`
            : "Cash to charity for five years, and 10% of the estate to charity from IRA money.",
          events: [
            {
              type: "charity_gift",
              amount: 100_000,
              fromAge: age,
              years: 5,
              accountId: account?.id ?? null,
              donorAdvised: true,
            },
            { type: "charitable_bequest", share: 0.1, fromIraFirst: true },
          ],
        };
      },
    },
    {
      id: "llc",
      tags: ["advanced", "kids"],
      title: "Family LLC with a valuation discount",
      status: "in_app",
      summary:
        "Put investments in a family LLC and give the kids shares over time, valued lower because they're hard to sell and don't control anything.",
      how: "You move investments into an LLC and keep managing them. Each year you give the kids LLC shares. Because a minority share can't be sold easily or control the LLC, an appraiser values it 20–35% below its slice of the assets, so each dollar of exclusion or exemption moves more. Once you own half or less, your own remaining share gets the discount in your estate too. The IRS scrutinizes these: it needs a real purpose beyond taxes, a qualified appraisal, and the formalities kept up.",
      pros: [
        "Moves more value per dollar of exemption",
        "You keep control as manager",
        "Keeps family investments together",
      ],
      cons: [
        "Legal setup, appraisals and yearly upkeep",
        "IRS scrutiny: aggressive discounts get challenged",
        "Shares given carry your cost basis (no step-up)",
      ],
      inApp:
        "The LLC as its own holding (still taxed to you), yearly share gifts reported at the discount, your remaining share discounted once you no longer control it, and each child's total.",
      tryIt: (h) => {
        const account = h.accounts.find((a) => giftableInKind(a.accountType));
        return firstChild(h) && account
          ? {
              name: "Family LLC",
              notes: `${money(3_000_000)} from ${account.name}, 10% of the LLC to the kids each year for 10 years at a 30% discount.`,
              events: [
                {
                  type: "family_llc",
                  accountId: account.id!,
                  age: nextAge(h),
                  amount: 3_000_000,
                  discount: 0.3,
                  giftShare: 0.1,
                  years: 10,
                },
              ],
            }
          : null;
      },
    },
    {
      id: "grat",
      tags: ["advanced", "kids"],
      title: "GRATs (annuity trusts)",
      status: "in_app",
      summary: `A trust pays you back what you put in plus interest at the IRS rate (${(facts.section7520 * 100).toFixed(1)}%); anything it grows beyond that goes to your kids, using no exemption.`,
      how: `You put investments in a GRAT, typically for two years. It pays you a fixed amount each year, worth exactly what you put in at the IRS §7520 rate (${(facts.section7520 * 100).toFixed(1)}% in ${afrMonthLabel(facts)}), so the gift counts as about $0. Growth above that rate goes to your kids at the end. If the investments don't beat the rate, everything comes back to you and you've lost little. "Rolling" GRATs put each payment into a new one, catching more good years. If you die during a term, that GRAT is counted back in your estate.`,
      pros: [
        "Moves upside with no exemption used",
        "Low risk: in a bad market you simply get your money back",
        "Works best on volatile, fast-growing stock",
      ],
      cons: [
        "Only pays off when returns beat the IRS rate, so it shines in some years, not all",
        "Needs an attorney and careful paperwork",
        "What passes keeps your cost basis",
      ],
      inApp:
        "GRATs held separately (taxed to you), annuity payments back or rolled, remainders to the kids at your basis, all across the range of markets.",
      tryIt: (h) => {
        const account = h.accounts.find((a) => giftableInKind(a.accountType));
        const age = nextAge(h);
        return firstChild(h) && account
          ? {
              name: "Rolling GRATs",
              notes: `${money(2_000_000)} from ${account.name} in 2-year GRATs, rolled for 10 years. Compare results in the range of outcomes: GRATs pay off in strong markets.`,
              events: [
                {
                  type: "grat",
                  accountId: account.id!,
                  age,
                  amount: 2_000_000,
                  termYears: 2,
                  rolling: true,
                  untilAge: age + 10,
                },
              ],
            }
          : null;
      },
    },
  ];
}
