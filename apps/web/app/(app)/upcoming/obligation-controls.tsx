"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ObligationMutationError } from "@/lib/data/obligations";
import type { ObligationCadence } from "@/lib/ledger/obligations";
import { formatMajorUnits } from "@/lib/ledger/minor-units";
import {
  inputClass,
  quietButton,
  responseErrorFor,
  RowForm,
  useMutation,
} from "../mutation-form";

export type ObligationAccount = { id: string; name: string; currency: string };
export type EditableObligation = {
  id: string;
  accountId: string;
  name: string;
  amountMinor: number;
  currency: string;
  cadence: ObligationCadence;
  startsOn: string;
  endsOn: string | null;
};

type ObligationDraft = Omit<EditableObligation, "id" | "amountMinor" | "endsOn"> & {
  amount: string;
  endsOn: string;
};

const ERROR_COPY: Record<ObligationMutationError | "invalid_request", string> = {
  invalid_request: "Check the obligation details and try again.",
  account_not_found: "That account is no longer available.",
  obligation_not_found: "That obligation is no longer available.",
};
const responseError = responseErrorFor(ERROR_COPY);
const CADENCES: { value: ObligationCadence; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Yearly" },
];

function ObligationForm({
  accounts,
  initial,
  label,
  submitLabel,
  endpoint,
  failure,
  onClose,
}: {
  accounts: ObligationAccount[];
  initial: ObligationDraft;
  label: string;
  submitLabel: string;
  endpoint: string;
  failure: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(initial.accountId);
  const [name, setName] = useState(initial.name);
  const [amount, setAmount] = useState(initial.amount);
  const [currency, setCurrency] = useState(initial.currency);
  const [cadence, setCadence] = useState<ObligationCadence>(initial.cadence);
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const { error, pending, run } = useMutation(responseError, () => {
    onClose();
    router.refresh();
  });

  return (
    <RowForm
      label={label}
      submitLabel={submitLabel}
      pending={pending}
      error={error}
      onCancel={onClose}
      onSubmit={() =>
        run(
          endpoint,
          {
            accountId,
            name,
            amount,
            currency,
            cadence,
            startsOn,
            endsOn: cadence === "once" ? null : endsOn || null,
          },
          failure,
        )
      }
    >
      <label className="min-w-0 text-sm font-medium">
        Name
        <input
          autoFocus
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          className={inputClass}
        />
      </label>
      <label className="min-w-0 text-sm font-medium">
        Account
        <select
          required
          value={accountId}
          onChange={(event) => {
            const selected = accounts.find((account) => account.id === event.target.value)!;
            setAccountId(selected.id);
            setCurrency(selected.currency);
          }}
          disabled={pending}
          className={inputClass}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 text-sm font-medium">
        Amount
        <input
          required
          inputMode="decimal"
          autoComplete="off"
          maxLength={32}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={pending}
          className={inputClass}
        />
      </label>
      <label className="min-w-0 text-sm font-medium">
        Currency
        <input
          required
          maxLength={3}
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          disabled={pending}
          className={inputClass}
        />
      </label>
      <label className="min-w-0 text-sm font-medium">
        First due date
        <input
          required
          type="date"
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
          disabled={pending}
          className={inputClass}
        />
      </label>
      <label className="min-w-0 text-sm font-medium">
        Repeat
        <select
          value={cadence}
          onChange={(event) => setCadence(event.target.value as ObligationCadence)}
          disabled={pending}
          className={inputClass}
        >
          {CADENCES.map(({ value, label: cadenceLabel }) => (
            <option key={value} value={value}>
              {cadenceLabel}
            </option>
          ))}
        </select>
      </label>
      {cadence !== "once" && (
        <label className="min-w-0 text-sm font-medium">
          Final date
          <input
            type="date"
            min={startsOn || undefined}
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </label>
      )}
    </RowForm>
  );
}

export function AddObligation({ accounts }: { accounts: ObligationAccount[] }) {
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const firstAccount = accounts[0];
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !returnFocus.current) return;
    button.current?.focus();
    returnFocus.current = false;
  }, [open]);

  if (!open) {
    return (
      <button
        id="add-obligation"
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-4 ${quietButton}`}
      >
        Add obligation
      </button>
    );
  }

  return (
    <ObligationForm
      accounts={accounts}
      initial={{
        accountId: firstAccount.id,
        name: "",
        amount: "",
        currency: firstAccount.currency,
        cadence: "once",
        startsOn: "",
        endsOn: "",
      }}
      label="Add obligation"
      submitLabel="Add obligation"
      endpoint="/api/obligations"
      failure="Couldn’t add the obligation. Try again."
      onClose={close}
    />
  );
}

export function EditObligation({
  accounts,
  obligation,
}: {
  accounts: ObligationAccount[];
  obligation: EditableObligation;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !returnFocus.current) return;
    button.current?.focus();
    returnFocus.current = false;
  }, [open]);

  if (!open) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={`Edit ${obligation.name}`}
        onClick={() => setOpen(true)}
        className={`mt-3 ${quietButton}`}
      >
        Edit
      </button>
    );
  }

  return (
    <ObligationForm
      accounts={accounts}
      initial={{
        accountId: obligation.accountId,
        name: obligation.name,
        amount: formatMajorUnits(obligation.amountMinor, obligation.currency),
        currency: obligation.currency,
        cadence: obligation.cadence,
        startsOn: obligation.startsOn,
        endsOn: obligation.endsOn ?? "",
      }}
      label={`Edit ${obligation.name}`}
      submitLabel="Save changes"
      endpoint={`/api/obligations/${obligation.id}`}
      failure="Couldn’t update the obligation. Try again."
      onClose={close}
    />
  );
}

export function EndObligation({
  obligation,
}: {
  obligation: Pick<EditableObligation, "id" | "name">;
}) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };
  const { error, pending, run } = useMutation(responseError, () => {
    document.getElementById("add-obligation")?.focus();
    router.refresh();
  });

  useEffect(() => {
    if (open || !returnFocus.current) return;
    button.current?.focus();
    returnFocus.current = false;
  }, [open]);

  if (!open) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={`End ${obligation.name}`}
        onClick={() => setOpen(true)}
        className={`mt-3 ${quietButton}`}
      >
        End
      </button>
    );
  }

  return (
    <RowForm
      label={`End ${obligation.name}`}
      submitLabel="End obligation"
      pending={pending}
      error={error}
      onCancel={close}
      onSubmit={() =>
        run(
          `/api/obligations/${obligation.id}/end`,
          {},
          "Couldn’t end the obligation. Try again.",
        )
      }
    >
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          End {obligation.name}?
        </span>{" "}
        It will stop appearing in Upcoming.
      </p>
    </RowForm>
  );
}
