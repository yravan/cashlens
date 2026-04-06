import { useQuery } from "@tanstack/react-query";
import { API_URL } from "@/lib/utils";

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
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const res = await fetch(`${API_URL}/api/data/accounts`);
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
  });
}
