import { expect, test } from "vitest";

import { SEED_TRANSACTIONS, SEED_TRANSFER_PAIRS } from "@/db/seed/dataset";
import {
  comboKey,
  matchTransferPairs,
  TRANSFER_WINDOW_DAYS,
  type MatchableRow,
} from "@/lib/ledger/transfer-matching";

const id = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;

const row = (n: number, over: Partial<MatchableRow> = {}): MatchableRow => ({
  id: id(n),
  accountId: "acct-a",
  amountMinor: -5000,
  currency: "USD",
  date: "2026-03-10",
  status: "posted",
  ...over,
});

const out = (n: number, over: Partial<MatchableRow> = {}) =>
  row(n, { accountId: "acct-a", amountMinor: -5000, ...over });
const inn = (n: number, over: Partial<MatchableRow> = {}) =>
  row(n, { accountId: "acct-b", amountMinor: 5000, ...over });

const pairs = (rows: MatchableRow[], excluded?: ReadonlySet<string>) =>
  matchTransferPairs(rows, excluded).map((p) => [p.outflowId, p.inflowId]);

test("an exact inverse same-day pair across two accounts matches", () => {
  expect(pairs([out(1), inn(2)])).toEqual([[id(1), id(2)]]);
});

test("the window is four days inclusive: the inflow four days after pairs, five does not", () => {
  expect(TRANSFER_WINDOW_DAYS).toBe(4);
  expect(pairs([out(1, { date: "2026-03-10" }), inn(2, { date: "2026-03-14" })])).toEqual([
    [id(1), id(2)],
  ]);
  expect(pairs([out(1, { date: "2026-03-10" }), inn(2, { date: "2026-03-15" })])).toEqual([]);
});

test("the window is symmetric: the inflow may post up to four days before the outflow", () => {
  expect(pairs([out(1, { date: "2026-03-10" }), inn(2, { date: "2026-03-06" })])).toEqual([
    [id(1), id(2)],
  ]);
  expect(pairs([out(1, { date: "2026-03-10" }), inn(2, { date: "2026-03-05" })])).toEqual([]);
});

test("the window counts calendar days across month boundaries", () => {
  expect(pairs([out(1, { date: "2026-02-27" }), inn(2, { date: "2026-03-03" })])).toEqual([
    [id(1), id(2)],
  ]);
  expect(pairs([out(1, { date: "2026-02-27" }), inn(2, { date: "2026-03-04" })])).toEqual([]);
});

test("magnitudes must be exactly inverse", () => {
  expect(pairs([out(1, { amountMinor: -5000 }), inn(2, { amountMinor: 4999 })])).toEqual([]);
  expect(pairs([out(1, { amountMinor: -5000 }), inn(2, { amountMinor: 5001 })])).toEqual([]);
});

test("currencies must match", () => {
  expect(pairs([out(1, { currency: "USD" }), inn(2, { currency: "EUR" })])).toEqual([]);
});

test("two halves in the same account never pair (a refund is not a transfer)", () => {
  expect(pairs([out(1), inn(2, { accountId: "acct-a" })])).toEqual([]);
});

test("zero amounts never pair", () => {
  expect(
    pairs([out(1, { amountMinor: 0 }), inn(2, { amountMinor: 0, accountId: "acct-b" })]),
  ).toEqual([]);
});

test("same-sign rows never pair", () => {
  expect(pairs([out(1), out(2, { accountId: "acct-b" })])).toEqual([]);
  expect(pairs([inn(1, { accountId: "acct-a" }), inn(2)])).toEqual([]);
});

test("a pending half keeps the pair unmatched until it posts", () => {
  expect(pairs([out(1, { status: "pending" }), inn(2)])).toEqual([]);
  expect(pairs([out(1), inn(2, { status: "pending" })])).toEqual([]);
});

test("with several candidates the closest date wins", () => {
  const rows = [
    out(1, { date: "2026-03-10" }),
    inn(2, { date: "2026-03-13" }),
    inn(3, { date: "2026-03-11", accountId: "acct-c" }),
  ];
  expect(pairs(rows)).toEqual([[id(1), id(3)]]);
});

test("a date-distance tie resolves deterministically by inflow id", () => {
  const rows = [
    out(1, { date: "2026-03-10" }),
    inn(3, { date: "2026-03-11" }),
    inn(2, { date: "2026-03-09", accountId: "acct-c" }),
  ];
  expect(pairs(rows)).toEqual([[id(1), id(2)]]);
});

test("a same-day tie between outflows resolves deterministically by outflow id", () => {
  const rows = [out(2), out(1, { accountId: "acct-c" }), inn(3)];
  expect(pairs(rows)).toEqual([[id(1), id(3)]]);
});

test("each transaction lands in at most one pair, and losers cascade to their next candidate", () => {
  const rows = [
    out(1, { date: "2026-03-10" }),
    out(2, { date: "2026-03-12", accountId: "acct-c" }),
    inn(3, { date: "2026-03-10" }),
    inn(4, { date: "2026-03-15", accountId: "acct-d" }),
  ];
  expect(pairs(rows)).toEqual([
    [id(1), id(3)],
    [id(2), id(4)],
  ]);
});

test("a dense same-amount cluster still pairs one-to-one with no reuse", () => {
  const rows = [
    out(1),
    out(2, { accountId: "acct-c" }),
    out(3, { accountId: "acct-d" }),
    inn(4),
    inn(5, { accountId: "acct-e" }),
  ];
  const result = matchTransferPairs(rows);
  const used = result.flatMap((p) => [p.outflowId, p.inflowId]);
  expect(result).toHaveLength(2);
  expect(new Set(used).size).toBe(used.length);
});

test("recurring transfers pair within their own occurrence, never across the window", () => {
  const rows = [
    out(1, { date: "2026-03-01" }),
    inn(2, { date: "2026-03-01" }),
    out(3, { date: "2026-03-08" }),
    inn(4, { date: "2026-03-08" }),
  ];
  expect(pairs(rows)).toEqual([
    [id(1), id(2)],
    [id(3), id(4)],
  ]);
});

test("two identical transfers on the same day pair one-to-one deterministically", () => {
  const rows = [out(1), out(2, { accountId: "acct-c" }), inn(3), inn(4, { accountId: "acct-d" })];
  expect(pairs(rows)).toEqual([
    [id(1), id(3)],
    [id(2), id(4)],
  ]);
});

test("an excluded combination is skipped and the next candidate wins instead", () => {
  const rows = [
    out(1, { date: "2026-03-10" }),
    inn(2, { date: "2026-03-10" }),
    inn(3, { date: "2026-03-12", accountId: "acct-c" }),
  ];
  expect(pairs(rows, new Set([comboKey(id(1), id(2))]))).toEqual([[id(1), id(3)]]);
  expect(pairs(rows, new Set([comboKey(id(1), id(2)), comboKey(id(1), id(3))]))).toEqual([]);
});

test("exclusion is directional storage but never re-pairs the same two rows", () => {
  const rows = [out(1), inn(2)];
  expect(pairs(rows, new Set([comboKey(id(1), id(2))]))).toEqual([]);
});

test("independent pairs in different currencies coexist", () => {
  const rows = [
    out(1, { currency: "USD" }),
    inn(2, { currency: "USD" }),
    out(3, { currency: "EUR", accountId: "acct-c" }),
    inn(4, { currency: "EUR", accountId: "acct-d" }),
  ];
  expect(pairs(rows)).toEqual([
    [id(1), id(2)],
    [id(3), id(4)],
  ]);
});

test("different magnitudes never cross-pair even inside the window", () => {
  const rows = [
    out(1, { amountMinor: -5000 }),
    out(2, { amountMinor: -7500, accountId: "acct-c" }),
    inn(3, { amountMinor: 7500 }),
    inn(4, { amountMinor: 5000, accountId: "acct-d" }),
  ];
  expect(pairs(rows)).toEqual([
    [id(1), id(4)],
    [id(2), id(3)],
  ]);
});

test("the result is identical no matter how the input is ordered", () => {
  const rows = [
    out(1, { date: "2026-03-10" }),
    out(2, { date: "2026-03-12", accountId: "acct-c" }),
    inn(3, { date: "2026-03-11" }),
    inn(4, { date: "2026-03-12", accountId: "acct-d" }),
    inn(5, { date: "2026-03-20", accountId: "acct-e" }),
  ];
  const forward = pairs(rows);
  const reversed = pairs([...rows].reverse());
  const shuffled = pairs([rows[3], rows[0], rows[4], rows[2], rows[1]]);
  expect(reversed).toEqual(forward);
  expect(shuffled).toEqual(forward);
});

test("the seeded demo ledger yields exactly the dataset's two hand-verified pairs", () => {
  const demoRows: MatchableRow[] = SEED_TRANSACTIONS.filter((t) => t.persona === "demo").map(
    (t) => ({
      id: t.id,
      accountId: t.accountId,
      amountMinor: t.amountMinor,
      currency: t.currency,
      date: t.date,
      status: t.status ?? "posted",
    }),
  );
  const found = matchTransferPairs(demoRows).map((p) => ({
    outflowId: p.outflowId,
    inflowId: p.inflowId,
  }));
  expect(found).toEqual(
    SEED_TRANSFER_PAIRS.filter((p) => p.persona === "demo").map(
      ({ outflowId, inflowId }) => ({ outflowId, inflowId }),
    ),
  );
});

test("the seeded neighbor ledger yields no pairs", () => {
  const neighborRows: MatchableRow[] = SEED_TRANSACTIONS.filter(
    (t) => t.persona === "neighbor",
  ).map((t) => ({
    id: t.id,
    accountId: t.accountId,
    amountMinor: t.amountMinor,
    currency: t.currency,
    date: t.date,
    status: t.status ?? "posted",
  }));
  expect(matchTransferPairs(neighborRows)).toEqual([]);
});
