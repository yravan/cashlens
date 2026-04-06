import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CashLens",
  description: "LLM-powered personal finance tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
