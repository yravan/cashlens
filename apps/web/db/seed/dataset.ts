import type { accountBalances, accounts, categories, transactions, users } from "../../lib/db/schema.ts";
import { DEFAULT_CATEGORIES } from "../../lib/ledger/default-categories.ts";

export const SEED_PERSONAS = ["demo", "neighbor", "empty"] as const;
export type SeedPersona = (typeof SEED_PERSONAS)[number];

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const SEED_USERS: Record<SeedPersona, typeof users.$inferInsert & { id: string }> = {
  demo: { id: uid(0x01), clerkUserId: "user_SeedDemo0000000000000000000" },
  neighbor: { id: uid(0x02), clerkUserId: "user_SeedNeighbor000000000000000" },
  empty: { id: uid(0x03), clerkUserId: "user_SeedEmpty000000000000000000" },
};

export const SEED_CLERK_IDS = Object.values(SEED_USERS).map((user) => user.clerkUserId);

type SeedRow<T extends { userId: string }> = Omit<T, "userId"> & { persona: SeedPersona };

const A = {
  checking: uid(0x101),
  savings: uid(0x102),
  card: uid(0x103),
  wallet: uid(0x104),
  euro: uid(0x105),
  neighborChecking: uid(0x106),
} as const;

export const SEED_ACCOUNTS: (SeedRow<typeof accounts.$inferInsert> & { id: string })[] = [
  { persona: "demo", id: A.checking, name: "Everyday Checking", type: "depository", subtype: "checking", mask: "0100", currency: "USD", source: "plaid", sourceId: "seed-acct-checking" },
  { persona: "demo", id: A.savings, name: "Rainy Day Savings", type: "depository", subtype: "savings", mask: "0200", currency: "USD", source: "plaid", sourceId: "seed-acct-savings" },
  { persona: "demo", id: A.card, name: "Cash Rewards Card", type: "credit", subtype: "credit card", mask: "4321", currency: "USD", source: "plaid", sourceId: "seed-acct-card" },
  { persona: "demo", id: A.wallet, name: "Cash Wallet", type: "other", subtype: null, mask: null, currency: "USD", source: "manual", sourceId: null },
  { persona: "demo", id: A.euro, name: "Berlin Checking", type: "depository", subtype: "checking", mask: "0300", currency: "EUR", source: "import", sourceId: "seed-acct-euro" },
  { persona: "neighbor", id: A.neighborChecking, name: "Neighbor Checking", type: "depository", subtype: "checking", mask: "0900", currency: "USD", source: "plaid", sourceId: "seed-acct-neighbor" },
];

type SeedCategory = SeedRow<typeof categories.$inferInsert> & {
  id: string;
  parentId: string | null;
};

const CATEGORY_ID_BASE = { demo: 0x1000, neighbor: 0x2000 } as const;

export const SEED_CATEGORIES: SeedCategory[] = (
  Object.entries(CATEGORY_ID_BASE) as [keyof typeof CATEGORY_ID_BASE, number][]
).flatMap(([persona, base]) => {
  let n = 0;
  return DEFAULT_CATEGORIES.flatMap(({ group, categories: names }, groupIndex) => {
    const parent: SeedCategory = {
      persona,
      id: uid(base + n++),
      parentId: null,
      name: group,
      sortOrder: groupIndex,
    };
    const leaves = names.map(
      (name, index): SeedCategory => ({
        persona,
        id: uid(base + n++),
        parentId: parent.id,
        name,
        sortOrder: index,
      }),
    );
    return [parent, ...leaves];
  });
});

const category = (persona: SeedPersona, name: string): string => {
  const found = SEED_CATEGORIES.find(
    (row) => row.persona === persona && row.name === name && row.parentId !== null,
  );
  if (!found) throw new Error(`no seed category named ${name}`);
  return found.id;
};

type SeedTransaction = SeedRow<typeof transactions.$inferInsert> & { id: string };

const txn = (
  n: number,
  persona: SeedPersona,
  accountId: string,
  amountMinor: number,
  currency: string,
  date: string,
  description: string,
  rest: Partial<SeedTransaction> = {},
): SeedTransaction => ({
  id: uid(0x200 + n),
  persona,
  accountId,
  amountMinor,
  currency,
  date,
  description,
  merchant: null,
  status: "posted",
  source: "plaid",
  sourceId: `seed-txn-${n}`,
  ...rest,
});

export const SEED_TRANSACTIONS: SeedTransaction[] = [
  txn(1, "demo", A.checking, 250000, "USD", "2026-02-27", "ACME CORP PAYROLL", { merchant: "Acme Corp", categoryId: category("demo", "Paycheck") }),
  txn(2, "demo", A.checking, -120000, "USD", "2026-03-02", "TRANSFER TO RAINY DAY SAVINGS"),
  txn(3, "demo", A.savings, 120000, "USD", "2026-03-02", "TRANSFER FROM EVERYDAY CHECKING"),
  txn(4, "demo", A.checking, -85000, "USD", "2026-03-05", "CASH REWARDS CARD PAYMENT"),
  txn(5, "demo", A.card, 85000, "USD", "2026-03-07", "PAYMENT RECEIVED - THANK YOU"),
  txn(6, "demo", A.checking, -6742, "USD", "2026-03-08", "MAPLE MARKET #204", { merchant: "Maple Market", categoryId: category("demo", "Groceries") }),
  txn(7, "demo", A.checking, -1250, "USD", "2026-03-16", "BEAN BARREL COFFEE", { merchant: "Bean Barrel", status: "pending", categoryId: category("demo", "Coffee Shops") }),
  txn(8, "demo", A.checking, 250000, "USD", "2026-03-27", "ACME CORP PAYROLL", { merchant: "Acme Corp", categoryId: category("demo", "Paycheck") }),
  txn(9, "demo", A.savings, 3113, "USD", "2026-03-31", "INTEREST PAYMENT"),
  txn(10, "demo", A.card, -18999, "USD", "2026-02-21", "SKYLINE AIR TICKETS", { merchant: "Skyline Air" }),
  txn(11, "demo", A.card, -4437, "USD", "2026-03-03", "NOODLE HOUSE", { merchant: "Noodle House", categoryId: category("demo", "Restaurants & Bars") }),
  txn(12, "demo", A.card, 18999, "USD", "2026-03-12", "SKYLINE AIR REFUND", { merchant: "Skyline Air" }),
  txn(13, "demo", A.card, -2300, "USD", "2026-03-29", "STREAMFLIX", { merchant: "Streamflix", categoryId: category("demo", "Streaming & Music") }),
  txn(14, "demo", A.wallet, -1800, "USD", "2026-03-14", "FARMERS MARKET CASH", { source: "manual", sourceId: null }),
  txn(15, "demo", A.euro, -5650, "EUR", "2026-03-10", "BAHN TICKET BERLIN", { source: "import", categoryId: category("demo", "Public Transit") }),
  txn(16, "demo", A.euro, 20000, "EUR", "2026-03-11", "AIRBNB PAYOUT", { merchant: "Airbnb", source: "import" }),
  txn(17, "neighbor", A.neighborChecking, 75000, "USD", "2026-03-06", "NEIGHBOR PAYCHECK"),
  txn(18, "neighbor", A.neighborChecking, -12345, "USD", "2026-03-09", "ELECTRONICS EMPORIUM", { merchant: "Electronics Emporium", categoryId: category("neighbor", "Electronics") }),
];

const AS_OF = new Date("2026-03-31T12:00:00Z");

export const SEED_BALANCES: SeedRow<typeof accountBalances.$inferInsert>[] = [
  { persona: "demo", accountId: A.checking, availableMinor: 234120, currentMinor: 235370, limitMinor: null, asOf: AS_OF },
  { persona: "demo", accountId: A.savings, availableMinor: 1500000, currentMinor: 1500000, limitMinor: null, asOf: AS_OF },
  { persona: "demo", accountId: A.card, availableMinor: 748755, currentMinor: 51245, limitMinor: 800000, asOf: AS_OF },
  { persona: "demo", accountId: A.wallet, availableMinor: null, currentMinor: 8600, limitMinor: null, asOf: AS_OF },
  { persona: "demo", accountId: A.euro, availableMinor: 120450, currentMinor: 120450, limitMinor: null, asOf: AS_OF },
  { persona: "neighbor", accountId: A.neighborChecking, availableMinor: 50000, currentMinor: 50000, limitMinor: null, asOf: AS_OF },
];

type PostedTotals = { inflowMinor: number; outflowMinor: number; netMinor: number; count: number };
type OverviewAccount = Pick<
  (typeof SEED_ACCOUNTS)[number],
  "name" | "type" | "subtype" | "mask" | "currency"
> & { currentMinor: number | null };

export type ExpectedPersona = {
  accounts: number;
  transactions: number;
  balances: number;
  pendingCount: number;
  categories: number;
  assigned: Record<string, number>;
  posted: Record<string, PostedTotals>;
  overview: {
    accounts: OverviewAccount[];
    cashOnHand: Record<string, number>;
    creditOwed: Record<string, number>;
  };
};

const ACCOUNT_TYPE_ORDER = ["depository", "credit", "loan", "investment", "other"];

function overviewFor(persona: SeedPersona): ExpectedPersona["overview"] {
  const current = new Map(
    SEED_BALANCES.filter((b) => b.persona === persona).map((b) => [b.accountId, b.currentMinor ?? null]),
  );
  const accounts = SEED_ACCOUNTS.filter((a) => a.persona === persona)
    .map(({ id, name, type, subtype, mask, currency }) => ({
      name, type, subtype: subtype ?? null, mask: mask ?? null, currency, currentMinor: current.get(id) ?? null,
    }))
    .sort(
      (a, b) =>
        ACCOUNT_TYPE_ORDER.indexOf(a.type) - ACCOUNT_TYPE_ORDER.indexOf(b.type) ||
        a.name.localeCompare(b.name),
    );
  const total = (type: "depository" | "credit") => {
    const totals: Record<string, number> = {};
    for (const a of accounts) {
      if (a.type === type && a.currentMinor !== null) {
        totals[a.currency] = (totals[a.currency] ?? 0) + a.currentMinor;
      }
    }
    return totals;
  };
  return { accounts, cashOnHand: total("depository"), creditOwed: total("credit") };
}

function expectedFor(persona: SeedPersona): ExpectedPersona {
  const mine = SEED_TRANSACTIONS.filter((t) => t.persona === persona);
  const posted: Record<string, PostedTotals> = {};
  for (const t of mine) {
    if (t.status !== "posted") continue;
    const totals = (posted[t.currency] ??= { inflowMinor: 0, outflowMinor: 0, netMinor: 0, count: 0 });
    if (t.amountMinor >= 0) totals.inflowMinor += t.amountMinor;
    else totals.outflowMinor += t.amountMinor;
    totals.netMinor += t.amountMinor;
    totals.count += 1;
  }
  const nameOf = new Map(SEED_CATEGORIES.map((c) => [c.id, c.name]));
  const assigned: Record<string, number> = {};
  for (const t of mine) {
    if (!t.categoryId) continue;
    const name = nameOf.get(t.categoryId)!;
    assigned[name] = (assigned[name] ?? 0) + 1;
  }

  return {
    accounts: SEED_ACCOUNTS.filter((a) => a.persona === persona).length,
    transactions: mine.length,
    balances: SEED_BALANCES.filter((b) => b.persona === persona).length,
    pendingCount: mine.filter((t) => t.status === "pending").length,
    categories: SEED_CATEGORIES.filter((c) => c.persona === persona).length,
    assigned,
    posted,
    overview: overviewFor(persona),
  };
}

export const EXPECTED: Record<SeedPersona, ExpectedPersona> = {
  demo: expectedFor("demo"),
  neighbor: expectedFor("neighbor"),
  empty: expectedFor("empty"),
};
