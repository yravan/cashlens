"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { CategoryGroup } from "@/lib/data/categories";
import { formatMajorUnits } from "@/lib/ledger/minor-units";

type AccountOption = { id: string; name: string; currency: string };
type Draft = {
  accountId: string;
  direction: "outflow" | "inflow";
  amount: string;
  date: string;
  description: string;
  merchant: string;
  categoryId: string;
};
type ManualRow = {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  date: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
};
type ErrorCode =
  | "invalid_request"
  | "transaction_not_found"
  | "account_not_found"
  | "category_not_found"
  | "category_not_assignable";

const ERROR_COPY: Record<ErrorCode, string> = {
  invalid_request: "Check the transaction details and try again.",
  transaction_not_found: "That transaction is no longer available.",
  account_not_found: "That account is no longer available.",
  category_not_found: "That category is no longer available.",
  category_not_assignable: "Choose a category within a group.",
};

function localDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function errorCopy(value: unknown, fallback: string) {
  if (typeof value !== "object" || value === null || !("error" in value)) return fallback;
  const code = value.error;
  return typeof code === "string" && Object.hasOwn(ERROR_COPY, code)
    ? ERROR_COPY[code as ErrorCode]
    : fallback;
}

async function responseError(response: Response, fallback: string) {
  try {
    return errorCopy(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

function ManualForm({
  mode,
  draft,
  accounts,
  groups,
  endpoint,
  onChange,
  onCancel,
  onSaved,
}: {
  mode: "add" | "edit";
  draft: Draft;
  accounts: AccountOption[];
  groups: CategoryGroup[];
  endpoint: string;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const selectedAccount = accounts.find((account) => account.id === draft.accountId);
  const update = (field: keyof Draft, value: string) => onChange({ ...draft, [field]: value });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: draft.accountId,
            direction: draft.direction,
            amount: draft.amount,
            date: draft.date,
            description: draft.description,
            merchant: draft.merchant.trim() ? draft.merchant : null,
            categoryId: draft.categoryId || null,
          }),
        });
        if (!response.ok) {
          setError(await responseError(response, "Couldn’t save the transaction. Try again."));
          return;
        }
        onSaved();
      } catch {
        setError("Couldn’t save the transaction. Try again.");
      } finally {
        submittingRef.current = false;
      }
    });
  };

  const inputClass =
    "mt-1 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <form
      aria-label={mode === "add" ? "Add transaction" : "Edit transaction"}
      onSubmit={submit}
      className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">
          Account
          <select
            required
            value={draft.accountId}
            onChange={(event) => update("accountId", event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Choose an account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Direction
          <select
            value={draft.direction}
            onChange={(event) => update("direction", event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="outflow">Money out</option>
            <option value="inflow">Money in</option>
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Amount
          <input
            aria-label="Amount"
            required
            inputMode="decimal"
            autoComplete="off"
            maxLength={32}
            value={draft.amount}
            onChange={(event) => update("amount", event.target.value)}
            disabled={pending}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
            {selectedAccount ? `Account currency: ${selectedAccount.currency}` : "Choose an account first."}
          </span>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Date
          <input
            required
            type="date"
            value={draft.date}
            onChange={(event) => update("date", event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Description
          <input
            required
            maxLength={200}
            value={draft.description}
            onChange={(event) => update("description", event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Merchant
          <input
            maxLength={200}
            value={draft.merchant}
            onChange={(event) => update("merchant", event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="min-w-0 text-sm font-medium sm:col-span-2">
          Category
          <select
            value={draft.categoryId}
            onChange={(event) => update("categoryId", event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Uncategorized</option>
            {groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : mode === "add" ? "Add transaction" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AddManualTransaction({
  accounts,
  groups,
}: {
  accounts: AccountOption[];
  groups: CategoryGroup[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const open = () =>
    setDraft({
      accountId: "",
      direction: "outflow",
      amount: "",
      date: localDate(),
      description: "",
      merchant: "",
      categoryId: "",
    });

  return (
    <div className={draft ? "min-w-0 basis-full" : ""}>
      {draft ? (
        <ManualForm
          mode="add"
          draft={draft}
          accounts={accounts}
          groups={groups}
          endpoint="/api/transactions/manual"
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            router.refresh();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={open}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add transaction
        </button>
      )}
    </div>
  );
}

export function ManualTransactionActions({
  row,
  accounts,
  groups,
}: {
  row: ManualRow;
  accounts: AccountOption[];
  groups: CategoryGroup[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const edit = () => {
    setConfirming(false);
    setError(null);
    setDraft({
      accountId: row.accountId,
      direction: row.amountMinor < 0 ? "outflow" : "inflow",
      amount: formatMajorUnits(Math.abs(row.amountMinor), row.currency),
      date: row.date,
      description: row.description,
      merchant: row.merchant ?? "",
      categoryId: row.categoryId ?? "",
    });
  };

  const remove = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/transactions/${row.id}/manual/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          setError(await responseError(response, "Couldn’t delete the transaction. Try again."));
          return;
        }
        router.refresh();
      } catch {
        setError("Couldn’t delete the transaction. Try again.");
      } finally {
        submittingRef.current = false;
      }
    });
  };

  if (draft) {
    return (
      <ManualForm
        mode="edit"
        draft={draft}
        accounts={accounts}
        groups={groups}
        endpoint={`/api/transactions/${row.id}/manual`}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
      {confirming ? (
        <>
          <span>Delete permanently?</span>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={pending}
            className="underline underline-offset-4 disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={edit} className="underline underline-offset-4">
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className="text-red-700 underline underline-offset-4 dark:text-red-400"
          >
            Delete
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="basis-full text-sm text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
