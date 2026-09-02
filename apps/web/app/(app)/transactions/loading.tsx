export default function Loading() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
      <p role="status" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Loading transactions…
      </p>
      <div
        aria-hidden="true"
        className="mt-8 grid gap-4 border-y border-zinc-200 py-6 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800"
      >
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-9 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
        ))}
      </div>
      <div aria-hidden="true" className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="py-4">
            <div className="h-4 w-48 max-w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="mt-2 h-3 w-32 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </>
  );
}
