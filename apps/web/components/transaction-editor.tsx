"use client";

import { Loader2, PencilLine } from "lucide-react";
import { startTransition, useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";

import type { Transaction } from "@/lib/types";

type TransactionEditorProps = {
  transaction: Transaction;
};

export function TransactionEditor({ transaction }: TransactionEditorProps) {
  const router = useRouter();
  const [category, setCategory] = useState(transaction.category ?? "");
  const [subcategory, setSubcategory] = useState(transaction.subcategory ?? "");
  const [eventType, setEventType] = useState(transaction.event_type);
  const [excludeFromSpend, setExcludeFromSpend] = useState(transaction.exclude_from_spend);
  const [pending, setPending] = useState(false);
  const deferredCategory = useDeferredValue(category);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await fetch(`/api/proxy/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: deferredCategory || null,
          subcategory: subcategory || null,
          event_type: eventType,
          exclude_from_spend: excludeFromSpend,
        }),
      });
      startTransition(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 rounded-[28px] border border-[var(--border)] bg-white/76 p-5 shadow-[var(--card-shadow)] backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-[var(--accent-soft)] p-3 text-[var(--accent-strong)]">
          <PencilLine className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold tracking-tight text-[var(--foreground)]">Review transaction</h3>
          <p className="text-sm text-[var(--muted)]">{transaction.merchant_name}</p>
        </div>
      </div>

      <label className="grid gap-2 text-sm font-medium text-[var(--foreground)]">
        Event type
        <select
          value={eventType}
          onChange={(event) => setEventType(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none"
        >
          <option value="purchase">purchase</option>
          <option value="income">income</option>
          <option value="refund">refund</option>
          <option value="transfer">transfer</option>
          <option value="credit_card_payment">credit_card_payment</option>
          <option value="fee">fee</option>
          <option value="adjustment">adjustment</option>
          <option value="unknown">unknown</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium text-[var(--foreground)]">
        Category
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none"
          placeholder="groceries"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-[var(--foreground)]">
        Subcategory
        <input
          value={subcategory}
          onChange={(event) => setSubcategory(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none"
          placeholder="produce"
        />
      </label>

      <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-medium text-[var(--foreground)]">
        <input
          type="checkbox"
          checked={excludeFromSpend}
          onChange={(event) => setExcludeFromSpend(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        Exclude from true spend
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent-strong)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {pending ? "Saving changes" : "Save review changes"}
      </button>
    </form>
  );
}
