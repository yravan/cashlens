"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { OfflineAccountError } from "@/lib/data/offline-accounts";
import { formatMajorUnits } from "@/lib/ledger/minor-units";
import {
  OFFLINE_CURRENCIES,
  OFFLINE_TYPE_LABELS,
  OWED_TYPES,
  type OfflineAccountType,
} from "@/lib/ledger/offline-accounts";

const ERROR_COPY: Record<OfflineAccountError, string> = {
  invalid_request: "Check the account details and try again.",
  account_not_found: "That account is no longer available.",
};
const TYPES = Object.entries(OFFLINE_TYPE_LABELS) as [OfflineAccountType, string][];

const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";
const formClass =
  "min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950";
const primaryButton =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const quietButton =
  "rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700";
const dangerButton =
  "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50";

function localDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

const balanceLabel = (type: OfflineAccountType) =>
  OWED_TYPES.has(type) ? "Amount owed" : "Current balance";

const signedMajor = (minor: number, currency: string) =>
  `${minor < 0 ? "-" : ""}${formatMajorUnits(Math.abs(minor), currency)}`;

function errorCopy(value: unknown, fallback: string) {
  if (typeof value !== "object" || value === null || !("error" in value)) return fallback;
  const code = value.error;
  return typeof code === "string" && Object.hasOwn(ERROR_COPY, code)
    ? ERROR_COPY[code as OfflineAccountError]
    : fallback;
}

async function responseError(response: Response, fallback: string) {
  try {
    return errorCopy(await response.json(), fallback);
  } catch {
    return fallback;
  }
}

const post = (endpoint: string, body: unknown) =>
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function useMutation(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const run = (endpoint: string, body: unknown, failure: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await post(endpoint, body);
        if (!response.ok) {
          setError(await responseError(response, failure));
          return;
        }
        onDone();
      } catch {
        setError(failure);
      } finally {
        submittingRef.current = false;
      }
    });
  };
  return { error, setError, pending, run };
}

function BalanceField({
  type,
  currency,
  value,
  onChange,
  disabled,
}: {
  type: OfflineAccountType;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const hintId = useId();
  return (
    <div className="min-w-0">
      <label className="block text-sm font-medium">
        {balanceLabel(type)}
        <input
          required
          inputMode="decimal"
          autoComplete="off"
          maxLength={32}
          aria-describedby={hintId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={inputClass}
        />
      </label>
      <p id={hintId} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Account currency: {currency}
      </p>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
      {error}
    </p>
  );
}

export function AddOfflineAccount({ currencies }: { currencies: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<OfflineAccountType>("depository");
  const [currency, setCurrency] = useState("USD");
  const [balance, setBalance] = useState("");
  const { error, setError, pending, run } = useMutation(() => {
    setOpen(false);
    setName("");
    setBalance("");
    router.refresh();
  });
  const options = [...new Set([...OFFLINE_CURRENCIES, ...currencies])].sort();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      "/api/accounts/manual",
      { name, type, currency, balance, reportedOn: localDate() },
      "Couldn’t add the account. Try again.",
    );
  };

  if (!open) {
    return (
      <div className="mt-6">
        <button
          type="button"
          data-testid="add-offline-account"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className={quietButton}
        >
          Add offline account
        </button>
      </div>
    );
  }

  return (
    <form
      aria-label="Add offline account"
      onSubmit={submit}
      className={`mt-6 basis-full ${formClass}`}
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">
          Name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value as OfflineAccountType)}
            disabled={pending}
            className={inputClass}
          >
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Currency
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            {options.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <BalanceField
          type={type}
          currency={currency}
          value={balance}
          onChange={setBalance}
          disabled={pending}
        />
      </div>
      <ErrorLine error={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Add account"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={quietButton}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function OfflineAccountActions({
  account,
}: {
  account: {
    id: string;
    name: string;
    type: OfflineAccountType;
    currency: string;
    reportedMinor: number | null;
    transactionCount: number;
  };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "balance" | "delete">("idle");
  const [balance, setBalance] = useState("");
  const { error, setError, pending, run } = useMutation(() => {
    setMode("idle");
    router.refresh();
  });
  const close = () => {
    setMode("idle");
    setError(null);
  };
  const consequence = `${account.transactionCount} transaction${
    account.transactionCount === 1 ? "" : "s"
  }`;

  if (mode === "balance") {
    return (
      <form
        aria-label="Update balance"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            `/api/accounts/${account.id}/manual`,
            { balance, reportedOn: localDate() },
            "Couldn’t update the balance. Try again.",
          );
        }}
        className={`mt-3 ${formClass}`}
      >
        <div className="grid min-w-0 gap-4 sm:max-w-sm">
          <BalanceField
            type={account.type}
            currency={account.currency}
            value={balance}
            onChange={setBalance}
            disabled={pending}
          />
        </div>
        <ErrorLine error={error} />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Saving…" : "Save balance"}
          </button>
          <button type="button" onClick={close} disabled={pending} className={quietButton}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === "delete") {
    return (
      <div
        data-testid="delete-account-confirm"
        className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
      >
        <p className="text-sm">
          Delete {account.name} and its {consequence}? This cannot be undone.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              run(
                `/api/accounts/${account.id}/manual/delete`,
                {},
                "Couldn’t delete the account. Try again.",
              )
            }
            disabled={pending}
            className={dangerButton}
          >
            {pending ? "Deleting…" : "Delete account"}
          </button>
          <button type="button" onClick={close} disabled={pending} className={quietButton}>
            Cancel
          </button>
        </div>
        <ErrorLine error={error} />
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        onClick={() => {
          setBalance(
            account.reportedMinor === null
              ? ""
              : signedMajor(account.reportedMinor, account.currency),
          );
          setError(null);
          setMode("balance");
        }}
        className="underline underline-offset-4"
      >
        Update balance
      </button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode("delete");
        }}
        className="text-red-700 underline underline-offset-4 dark:text-red-400"
      >
        Delete
      </button>
    </div>
  );
}
