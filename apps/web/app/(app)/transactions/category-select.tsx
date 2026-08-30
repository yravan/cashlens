"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { CategoryGroup } from "@/lib/data/categories";

export function CategorySelect({
  transactionId,
  categoryId,
  label,
  groups,
}: {
  transactionId: string;
  categoryId: string | null;
  label: string;
  groups: CategoryGroup[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(categoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(categoryId);
  if (categoryId !== seen) {
    setSeen(categoryId);
    setValue(categoryId ?? "");
  }

  const save = async (next: string) => {
    setValue(next);
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/category`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: next || null }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setValue(categoryId ?? "");
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <span className="flex flex-col items-start gap-1">
      <select
        value={value}
        onChange={(event) => save(event.target.value)}
        disabled={busy}
        aria-label={`Category for ${label}`}
        className="w-full max-w-56 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
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
      {failed && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          Couldn&apos;t save — try again.
        </span>
      )}
    </span>
  );
}
