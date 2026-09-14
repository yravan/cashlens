import { randomUUID } from "node:crypto";

import { requireUser } from "@/lib/data/users";
import { accountBalances, accounts } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

export async function provisionedUser() {
  const clerkUserId = fakeClerkUserId();
  const user = await withAuth(clerkUserId, () => requireUser());
  return { clerkUserId, id: user.id };
}

type AnchoredAccount = {
  userId: string;
  name: string;
  type: "depository" | "credit" | "loan" | "investment" | "other";
  source?: "plaid" | "manual" | "import";
  currency?: string;
  currentMinor: number;
  reportedOn?: string | null;
};

export async function anchoredAccount(row: AnchoredAccount) {
  const [account] = await adminDb()
    .insert(accounts)
    .values({
      userId: row.userId,
      name: row.name,
      type: row.type,
      currency: row.currency ?? "USD",
      source: row.source ?? "manual",
      sourceId: row.source && row.source !== "manual" ? `seed-${randomUUID()}` : null,
    })
    .returning({ id: accounts.id });
  await adminDb().insert(accountBalances).values({
    accountId: account.id,
    userId: row.userId,
    availableMinor: null,
    currentMinor: row.currentMinor,
    limitMinor: null,
    asOf: new Date("2026-04-01T12:00:00Z"),
    reportedOn: row.reportedOn === undefined ? "2026-04-01" : row.reportedOn,
  });
  return account.id;
}

export type RequestBody = BodyInit | null;

export const request = (url: string, body: RequestBody, origin?: string) =>
  new Request(url, {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body,
    duplex: "half",
  } as RequestInit);

export const responseBytes = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.text(),
});

export const jsonBytes = (status: number, error: string) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify({ error }),
});
