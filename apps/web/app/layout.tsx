import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import { clerkEnabled } from "@/lib/runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cash Lens",
  description: "A ledger-first personal finance dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = clerkEnabled ? <ClerkProvider dynamic>{children}</ClerkProvider> : children;

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{content}</body>
    </html>
  );
}
