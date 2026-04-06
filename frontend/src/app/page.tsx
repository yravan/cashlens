"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TELLER_APP_ID = process.env.NEXT_PUBLIC_TELLER_APP_ID || "";
const TELLER_ENV = process.env.NEXT_PUBLIC_TELLER_ENV || "sandbox";

type Account = {
  provider_id: string;
  name: string;
  institution_name: string | null;
  account_type: string | null;
  account_subtype: string | null;
  mask: string | null;
  balance_current: string | null;
  balance_available: string | null;
};

type Transaction = {
  provider_id: string;
  date: string;
  amount: string;
  description: string;
  merchant_name: string | null;
  category: string | null;
  transaction_type: string;
  status: string;
  counterparty_name: string | null;
};

export default function Home() {
  const [accessToken, setAccessToken] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tellerReady, setTellerReady] = useState(false);

  async function handleConnect() {
    // Load Teller Connect script dynamically
    if (!(window as any).TellerConnect) {
      const script = document.createElement("script");
      script.src = "https://cdn.teller.io/connect/connect.js";
      script.onload = () => {
        setTellerReady(true);
        openTellerConnect();
      };
      document.head.appendChild(script);
    } else {
      openTellerConnect();
    }
  }

  function openTellerConnect() {
    const teller = (window as any).TellerConnect.setup({
      applicationId: TELLER_APP_ID,
      environment: TELLER_ENV,
      onSuccess: (enrollment: any) => {
        setAccessToken(enrollment.accessToken);
        setError("");
      },
      onFailure: (failure: any) => {
        setError(`Teller Connect failed: ${failure.message || "unknown error"}`);
      },
      onExit: () => {},
    });
    teller.open();
  }

  async function handleFetchAccounts() {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      // Connect + sync (saves to DB with 3-month backfill)
      const res = await fetch(
        `${API_URL}/api/ingestion/connect/teller?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${res.status} ${res.statusText}`);
      }

      // Load persisted data from DB
      await loadFromDB();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadFromDB() {
    const [acctRes, txnRes] = await Promise.all([
      fetch(`${API_URL}/api/data/accounts`),
      fetch(`${API_URL}/api/data/transactions?limit=200`),
    ]);
    if (acctRes.ok) setAccounts(await acctRes.json());
    if (txnRes.ok) setTransactions(await txnRes.json());
  }

  async function handleManualToken() {
    if (!accessToken) return;
    await handleFetchAccounts();
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">CashLens</h1>

      {/* Connect Section */}
      <section className="mb-8 rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">Connect Bank</h2>

        {TELLER_APP_ID ? (
          <button
            onClick={handleConnect}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Connect with Teller
          </button>
        ) : (
          <p className="text-sm text-gray-500">
            Set NEXT_PUBLIC_TELLER_APP_ID in .env to enable Teller Connect
          </p>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">
            Or paste access token (sandbox: test_token_ky6igyqi3qxa4)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="test_token_ky6igyqi3qxa4"
              className="flex-1 rounded border px-3 py-2 text-sm"
            />
            <button
              onClick={handleManualToken}
              disabled={!accessToken || loading}
              className="rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-900 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Fetch"}
            </button>
          </div>
        </div>

        {accessToken && !accounts.length && !loading && (
          <p className="mt-2 text-sm text-green-600">
            Token set. Click Fetch to load accounts.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {/* Accounts */}
      {accounts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">
            Accounts ({accounts.length})
          </h2>
          <div className="grid gap-3">
            {accounts.map((acct) => (
              <div key={acct.provider_id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{acct.name}</p>
                    <p className="text-sm text-gray-500">
                      {acct.institution_name} &middot;{" "}
                      {acct.account_subtype || acct.account_type} &middot;
                      ****{acct.mask}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg">
                      ${Number(acct.balance_current || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                    {acct.balance_available && (
                      <p className="text-xs text-gray-500">
                        Available: ${Number(acct.balance_available).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Transactions */}
      {transactions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Transactions ({transactions.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Description</th>
                  <th className="pb-2 pr-3">Category</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.provider_id} className="border-b">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {tx.date}
                      {tx.status === "pending" && (
                        <span className="ml-1 text-xs text-yellow-600">
                          pending
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {tx.merchant_name || tx.description}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{tx.category}</td>
                    <td
                      className={`py-2 text-right font-mono ${
                        Number(tx.amount) < 0
                          ? "text-green-600"
                          : "text-gray-900"
                      }`}
                    >
                      {Number(tx.amount) < 0 ? "+" : "-"}$
                      {Math.abs(Number(tx.amount)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
