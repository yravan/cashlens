"use client";

import Link from "next/link";
import { useRef } from "react";

export function ClearPeriodLink() {
  const link = useRef<HTMLAnchorElement>(null);

  return (
    <Link
      ref={link}
      href="/spending"
      onNavigate={() => link.current?.closest("form")?.reset()}
      className="text-sm text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      Clear
    </Link>
  );
}
