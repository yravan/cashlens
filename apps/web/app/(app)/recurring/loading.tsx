export default function Loading() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Recurring</h1>
      <p role="status" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Looking for repeating charges…
      </p>
      <div aria-hidden="true" className="mt-8 divide-y divide-zinc-200 dark:divide-zinc-800">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="flex items-center justify-between py-4">
            <div className="h-4 w-48 max-w-full rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <div className="h-4 w-24 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </>
  );
}
