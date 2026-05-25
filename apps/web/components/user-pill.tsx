"use client";

import { UserButton } from "@clerk/nextjs";

type UserPillProps = {
  authMode: "demo" | "clerk";
};

export function UserPill({ authMode }: UserPillProps) {
  if (authMode === "clerk") {
    return (
      <div className="rounded-full border border-[var(--border)] bg-white/80 px-2 py-1 shadow-sm">
        <UserButton />
      </div>
    );
  }

  return (
    <div className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2 text-sm font-semibold text-[var(--accent-strong)] shadow-sm">
      Demo workspace
    </div>
  );
}
