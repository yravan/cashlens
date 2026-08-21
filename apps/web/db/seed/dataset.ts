import type { accountBalances, accounts, transactions, users } from "../../lib/db/schema.ts";

export type SeedPersona = "demo" | "neighbor" | "empty";

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const SEED_USERS: Record<SeedPersona, typeof users.$inferInsert & { id: string }> = {
  demo: { id: uid(0x01), clerkUserId: "user_SeedDemo0000000000000000000" },
  neighbor: { id: uid(0x02), clerkUserId: "user_SeedNeighbor000000000000000" },
  empty: { id: uid(0x03), clerkUserId: "user_SeedEmpty000000000000000000" },
};

type SeedRow<T extends { userId: string }> = Omit<T, "userId"> & {
  id: string;
  persona: SeedPersona;
};

const A = {
  checking: uid(0x101),
  savings: uid(0x102),
  card: uid(0x103),
  wallet: uid(0x104),
  euro: uid(0x105),
  neighborChecking: uid(0x106),
} as const;

export const SEED_ACCOUNTS: SeedRow<typeof accounts.$inferInsert>[] = [
  { persona: "demo", id: A.checking, name: "Everyday Checking", type: "depository", subtype: "checking", mask: "0100", currency: "USD", source: "plaid", sourceId: "seed-acct-checking" },
  { persona: "demo", id: A.savings, name: "Rainy Day Savings", type: "depository", subtype: "savings", mask: "0200", currency: "USD", source: "plaid", sourceId: "seed-acct-savings" },
  { persona: "demo", id: A.card, name: "Cash Rewards Card", type: "credit", subtype: "credit card", mask: "4321", currency: "USD", source: "plaid", sourceId: "seed-acct-card" },
  { persona: "demo", id: A.wallet, name: "Cash Wallet", type: "other", subtype: null, mask: null, currency: "USD", source: "manual", sourceId: null },
  { persona: "demo", id: A.euro, name: "Berlin Checking", type: "depository", subtype: "checking", mask: "0300", currency: "EUR", source: "import", sourceId: "seed-acct-euro" },
  { persona: "neighbor", id: A.neighborChecking, name: "Neighbor Checking", type: "depository", subtype: "checking", mask: "0900", currency: "USD", source: "plaid", sourceId: "seed-acct-neighbor" },
];

type SeedTransaction = SeedRow<typeof transactions.$inferInsert>;

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
  txn(1, "demo", A.checking, 250000, "USD", "2026-02-27", "ACME CORP PAYROLL", { merchant: "Acme Corp" }),
  txn(2, "demo", A.checking, -120000, "USD", "2026-03-02", "TRANSFER TO RAINY DAY SAVINGS"),
  txn(3, "demo", A.savings, 120000, "USD", "2026-03-02", "TRANSFER FROM EVERYDAY CHECKING"),
  txn(4, "demo", A.checking, -85000, "USD", "2026-03-05", "CASH REWARDS CARD PAYMENT"),
  txn(5, "demo", A.card, 85000, "USD", "2026-03-07", "PAYMENT RECEIVED - THANK YOU"),
  txn(6, "demo", A.checking, -6742, "USD", "2026-03-08", "MAPLE MARKET #204", { merchant: "Maple Market" }),
  txn(7, "demo", A.checking, -1250, "USD", "2026-03-16", "BEAN BARREL COFFEE", { merchant: "Bean Barrel", status: "pending" }),
  txn(8, "demo", A.checking, 250000, "USD", "2026-03-27", "ACME CORP PAYROLL", { merchant: "Acme Corp" }),
  txn(9, "demo", A.savings, 3113, "USD", "2026-03-31", "INTEREST PAYMENT"),
  txn(10, "demo", A.card, -18999, "USD", "2026-02-21", "SKYLINE AIR TICKETS", { merchant: "Skyline Air" }),
  txn(11, "demo", A.card, -4437, "USD", "2026-03-03", "NOODLE HOUSE", { merchant: "Noodle House" }),
  txn(12, "demo", A.card, 18999, "USD", "2026-03-12", "SKYLINE AIR REFUND", { merchant: "Skyline Air" }),
  txn(13, "demo", A.card, -2300, "USD", "2026-03-29", "STREAMFLIX", { merchant: "Streamflix" }),
  txn(14, "demo", A.wallet, -1800, "USD", "2026-03-14", "FARMERS MARKET CASH", { source: "manual", sourceId: null }),
  txn(15, "demo", A.euro, -5650, "EUR", "2026-03-10", "BAHN TICKET BERLIN", { source: "import" }),
  txn(16, "demo", A.euro, 20000, "EUR", "2026-03-11", "AIRBNB PAYOUT", { merchant: "Airbnb", source: "import" }),
  txn(17, "neighbor", A.neighborChecking, 75000, "USD", "2026-03-06", "NEIGHBOR PAYCHECK"),
  txn(18, "neighbor", A.neighborChecking, -12345, "USD", "2026-03-09", "ELECTRONICS EMPORIUM", { merchant: "Electronics Emporium" }),
];

export const SEED_BALANCES: (Omit<SeedRow<typeof accountBalances.$inferInsert>, "id"> & {
  accountId: string;
})[] = [
  { persona: "demo", accountId: A.checking, availableMinor: 234120, currentMinor: 235370, limitMinor: null, asOf: new Date("2026-03-31T12:00:00Z") },
  { persona: "demo", accountId: A.savings, availableMinor: 1500000, currentMinor: 1500000, limitMinor: null, asOf: new Date("2026-03-31T12:00:00Z") },
  { persona: "demo", accountId: A.card, availableMinor: 748755, currentMinor: 51245, limitMinor: 800000, asOf: new Date("2026-03-31T12:00:00Z") },
  { persona: "demo", accountId: A.wallet, availableMinor: null, currentMinor: 8600, limitMinor: null, asOf: new Date("2026-03-31T12:00:00Z") },
  { persona: "demo", accountId: A.euro, availableMinor: 120450, currentMinor: 120450, limitMinor: null, asOf: new Date("2026-03-31T12:00:00Z") },
  { persona: "neighbor", accountId: A.neighborChecking, availableMinor: 50000, currentMinor: 50000, limitMinor: null, asOf: new Date("2026-03-31T12:00:00Z") },
];

type PostedTotals = { inflowMinor: number; outflowMinor: number; netMinor: number; count: number };

export type ExpectedPersona = {
  accounts: number;
  transactions: number;
  balances: number;
  pendingCount: number;
  posted: Record<string, PostedTotals>;
};

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
  return {
    accounts: SEED_ACCOUNTS.filter((a) => a.persona === persona).length,
    transactions: mine.length,
    balances: SEED_BALANCES.filter((b) => b.persona === persona).length,
    pendingCount: mine.filter((t) => t.status === "pending").length,
    posted,
  };
}

export const EXPECTED: Record<SeedPersona, ExpectedPersona> = {
  demo: expectedFor("demo"),
  neighbor: expectedFor("neighbor"),
  empty: expectedFor("empty"),
};
