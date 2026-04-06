"use client";

import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/lib/api";

export type Account = {
  id: string;
  provider_id: string;
  name: string;
  institution_name: string | null;
  account_type: string | null;
  account_subtype: string | null;
  mask: string | null;
  balance_current: string | null;
  balance_available: string | null;
};

export function useGetAccounts() {
  const { apiFetch } = useApiClient();

  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      return apiFetch("/api/data/accounts");
    },
  });
}
