export default function Loading() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
      <p role="status" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Loading account balances…
      </p>
      <div
        aria-hidden="true"
        className="mt-10 grid border-y border-zinc-300 md:grid-cols-2 md:divide-x md:divide-zinc-300 dark:border-zinc-700 md:dark:divide-zinc-700"
      >
        {[0, 1].map((item) => (
          <div key={item} className="py-5 md:px-6 md:first:pl-0 md:last:pr-0">
            <div className="h-3 w-24 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="mt-5 h-7 w-36 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </>
  );
}
