import Form from "next/form";
import Link from "next/link";

import type { TransactionHistory } from "@/lib/data/ledger";
import type { HistoryParam } from "@/lib/ledger/history-query";

const field = "block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const control =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function HistoryFilters({
  options,
  values,
}: {
  options: TransactionHistory["options"];
  values: (key: HistoryParam) => string;
}) {
  return (
    <Form
      action="/transactions"
      data-testid="history-filters"
      aria-label="Filter transactions"
      className="mt-8 grid gap-4 border-y border-zinc-200 py-6 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800"
    >
      <label className={`${field} sm:col-span-2`}>
        Search
        <input
          type="search"
          name="q"
          defaultValue={values("q")}
          maxLength={100}
          placeholder="Merchant or description"
          className={control}
        />
      </label>
      <label className={field}>
        Account
        <select name="account" defaultValue={values("account")} className={control}>
          <option value="">All accounts</option>
          {options.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Category
        <select name="category" defaultValue={values("category")} className={control}>
          <option value="">All categories</option>
          {options.categoryGroups.map((group) => (
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
          {options.currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className={field}>
          Min amount
          <input
            type="number"
            name="min"
            defaultValue={values("min")}
            min={0}
            step="any"
            inputMode="decimal"
            className={control}
          />
        </label>
        <label className={field}>
          Max amount
          <input
            type="number"
            name="max"
            defaultValue={values("max")}
            min={0}
            step="any"
            inputMode="decimal"
            className={control}
          />
        </label>
      </div>
      <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Apply
        </button>
        <Link
          href="/transactions"
          className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Clear
        </Link>
      </div>
    </Form>
  );
}
