import "server-only";

import { auth } from "@clerk/nextjs/server";

import { DEMO_USER_EMAIL, clerkEnabled } from "@/lib/runtime";

export type AppSession = {
  mode: "demo" | "clerk";
  userId: string;
  email: string;
};

export async function getAppSession(options?: { requireAuth?: boolean }) {
  if (!clerkEnabled) {
    return {
      mode: "demo" as const,
      userId: "demo-user",
      email: DEMO_USER_EMAIL,
    };
  }

  const session = await auth();
  if (!session.userId && options?.requireAuth) {
    return session.redirectToSignIn();
  }

  return {
    mode: "clerk" as const,
    userId: session.userId ?? "",
    email: `${session.userId ?? "unknown"}@cashlens.local`,
  };
}
