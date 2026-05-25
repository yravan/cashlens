import { AppShell } from "@/components/app-shell";
import { getAppSession } from "@/lib/session";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAppSession({ requireAuth: true });
  return <AppShell authMode={session.mode}>{children}</AppShell>;
}
