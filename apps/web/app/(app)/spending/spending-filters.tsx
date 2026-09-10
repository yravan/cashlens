import Form from "next/form";

import type { SpendingParam } from "@/lib/ledger/history-query";
import { ClearFiltersLink } from "../clear-filters-link";

const field = "block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const control =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function SpendingFilters({
  currencies,
  values,
}: {
  currencies: string[];
  values: (key: SpendingParam) => string;
}) {
  return (
    <Form
      action="/spending"
      data-testid="spending-filters"
      aria-label="Choose a period"
      className="mt-8 grid gap-4 border-y border-zinc-200 py-6 sm:grid-cols-3 dark:border-zinc-800"
    >
      <label className={field}>
        From
        <input type="date" name="from" defaultValue={values("from")} className={control} />
      </label>
      <label className={field}>
        To
        <input type="date" name="to" defaultValue={values("to")} className={control} />
      </label>
      <label className={field}>
        Currency
        <select name="currency" defaultValue={values("currency")} className={control}>
          <option value="">Any currency</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-4 sm:col-span-3">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Apply
        </button>
        <ClearFiltersLink href="/spending" />
      </div>
    </Form>
  );
}
