"use client";

export default function AccountsError({ retry }: { retry: () => void }) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <section
        role="alert"
        className="mt-8 max-w-xl border-y border-zinc-300 py-6 dark:border-zinc-700"
      >
        <h2 className="text-lg font-medium tracking-tight">Account balances could not load</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Your financial data was not changed. Try loading the accounts again.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Try again
        </button>
      </section>
    </>
  );
}
