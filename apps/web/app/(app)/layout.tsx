import { AppShell } from "@/components/app-shell";
import { PlaidLinkProvider } from "@/components/plaid-link-provider";
import { apiFetch } from "@/lib/server-api";
import { getAppSession } from "@/lib/session";
import type { LinkTokenResponse } from "@/lib/types";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [session, linkToken] = await Promise.all([
    getAppSession(),
    apiFetch<LinkTokenResponse>("/plaid/create-link-token", { method: "POST" }),
  ]);

  return (
    <PlaidLinkProvider
      key={`${linkToken.mode}:${linkToken.link_token}`}
      initialMode={linkToken.mode}
      initialLinkToken={linkToken.link_token}
    >
      <AppShell authMode={session.mode}>{children}</AppShell>
    </PlaidLinkProvider>
  );
}
