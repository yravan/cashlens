export default function Loading() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p role="status" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Loading cash flow…
      </p>
      <div aria-hidden="true" className="mt-10 divide-y divide-zinc-200 border-t border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
        {[0, 1, 2].map((item) => (
          <div key={item} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div className="h-4 w-28 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((cell) => (
                <div key={cell} className="h-8 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
