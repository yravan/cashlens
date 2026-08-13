import { requireUser } from "@/lib/data/users";

export default async function DashboardPage() {
  await requireUser();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Cash-flow numbers land here (leaf 6.1.1).
      </p>
    </>
  );
}
