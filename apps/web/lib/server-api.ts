import "server-only";

import { auth } from "@clerk/nextjs/server";

import { API_BASE_URL, DEMO_USER_EMAIL, clerkEnabled } from "@/lib/runtime";
import { getAppSession } from "@/lib/session";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await getAppSession({ requireAuth: true });
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");

  if (session.mode === "demo") {
    headers.set("x-demo-user-email", DEMO_USER_EMAIL);
  } else {
    if (!clerkEnabled) {
      throw new Error("Clerk is not enabled for this environment.");
    }
    const authState = await auth();
    const token = await authState.getToken();
    if (!token) {
      throw new Error("Clerk session token was not available for the backend request.");
    }
    headers.set("authorization", `Bearer ${token}`);
  }

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}
