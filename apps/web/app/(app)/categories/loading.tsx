export default function Loading() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
      <p role="status" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Loading categories…
      </p>
      <div
        aria-hidden="true"
        className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
      >
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="py-4">
            <div className="h-5 w-40 max-w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="mt-3 h-4 w-24 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="mt-4 space-y-3 pl-4">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-4 w-52 max-w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
