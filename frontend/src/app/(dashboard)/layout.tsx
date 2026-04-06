import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, getToken } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Check onboarding status — redirect to /setup if not complete
  try {
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/onboarding/status`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const status = await res.json();
      if (!status.setup_complete) {
        redirect("/setup");
      }
    }
  } catch {
    // If the API is unreachable, let the user through to the dashboard
    // rather than blocking them in a redirect loop
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
