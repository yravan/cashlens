"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

type NavLinkProps = {
  href: string;
  icon: ReactNode;
  label: string;
};

export function NavLink({ href, icon, label }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm"
          : "text-[var(--muted)] hover:bg-white/70 hover:text-[var(--foreground)]",
      )}
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
