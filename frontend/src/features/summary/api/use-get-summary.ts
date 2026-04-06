"use client";

import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/lib/api";

export type SummaryData = {
  total_balance: number;
  income: number;
  expenses: number;
  net_cash_flow: number;
  savings_rate: number;
  income_change: number;
  expenses_change: number;
  categories: { name: string; value: number }[];
  daily: { date: string; income: number; expenses: number }[];
};

export function useGetSummary(params?: { from?: string; to?: string; accountId?: string }) {
  const { apiFetch } = useApiClient();

  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  if (params?.accountId) searchParams.set("account_id", params.accountId);

  return useQuery({
    queryKey: ["summary", params],
    queryFn: async (): Promise<SummaryData> => {
      const qs = searchParams.toString();
      try {
        return await apiFetch(`/api/data/summary${qs ? `?${qs}` : ""}`);
      } catch {
        // Fallback: compute from accounts + transactions client-side
        return computeSummaryFallback(apiFetch);
      }
    },
  });
}

async function computeSummaryFallback(
  apiFetch: (path: string, options?: RequestInit) => Promise<unknown>
): Promise<SummaryData> {
  const [accounts, transactions] = await Promise.all([
    apiFetch("/api/data/accounts").catch(() => []) as Promise<Record<string, unknown>[]>,
    apiFetch("/api/data/transactions?limit=500").catch(() => []) as Promise<Record<string, unknown>[]>,
  ]);

  const totalBalance = (accounts as Record<string, unknown>[]).reduce(
    (sum: number, a: Record<string, unknown>) => sum + Number(a.balance_current || 0),
    0
  );

  let income = 0;
  let expenses = 0;
  const categoryMap = new Map<string, number>();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyMap = new Map<string, { income: number; expenses: number }>();

  for (const tx of transactions as Record<string, unknown>[]) {
    const amt = Number(tx.amount);
    const txDate = new Date(tx.date as string);
    if (txDate >= thirtyDaysAgo) {
      if (amt < 0) {
        income += Math.abs(amt);
      } else {
        expenses += amt;
      }
      const cat = (tx.category as string) || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + Math.abs(amt));

      const dateKey = tx.date as string;
      const day = dailyMap.get(dateKey) || { income: 0, expenses: 0 };
      if (amt < 0) day.income += Math.abs(amt);
      else day.expenses += amt;
      dailyMap.set(dateKey, day);
    }
  }

  const categories = Array.from(categoryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const daily = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const netCashFlow = income - expenses;
  const savingsRate = income > 0 ? (netCashFlow / income) * 100 : 0;

  return {
    total_balance: totalBalance,
    income,
    expenses,
    net_cash_flow: netCashFlow,
    savings_rate: savingsRate,
    income_change: 0,
    expenses_change: 0,
    categories,
    daily,
  };
}
