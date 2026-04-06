"use client";

import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/lib/api";

export type Transaction = {
  id: string;
  provider_id: string;
  date: string;
  amount: string;
  description: string;
  merchant_name: string | null;
  category: string | null;
  transaction_type: string;
  status: string;
  counterparty_name: string | null;
  account_id: string | null;
  reviewed: boolean;
};

export function useGetTransactions(params?: {
  limit?: number;
  offset?: number;
  accountId?: string;
  from?: string;
  to?: string;
}) {
  const { apiFetch } = useApiClient();

  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.accountId) searchParams.set("account_id", params.accountId);
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);

  return useQuery({
    queryKey: ["transactions", params],
    queryFn: async (): Promise<Transaction[]> => {
      return apiFetch(`/api/data/transactions?${searchParams.toString()}`);
    },
  });
}
