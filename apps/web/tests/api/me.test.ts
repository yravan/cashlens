import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { GET } from "@/app/api/me/route";
import { users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

test("a signed-out request gets 401 and provisions nothing", async () => {
  const response = await GET();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
  expect(await adminDb().$count(users)).toBe(0);
});

test("the first signed-in request provisions one row and returns only its id and createdAt", async () => {
  const clerkUserId = fakeClerkUserId();
  const response = await withAuth(clerkUserId, () => GET());
  expect(response.status).toBe(200);

  const rows = await adminDb().select().from(users).where(eq(users.clerkUserId, clerkUserId));
  expect(rows).toHaveLength(1);
  expect(await response.json()).toEqual({
    id: rows[0].id,
    createdAt: rows[0].createdAt.toISOString(),
  });
});

test("repeat requests return the same identity and keep one row", async () => {
  const clerkUserId = fakeClerkUserId();
  const first = await (await withAuth(clerkUserId, () => GET())).json();
  const second = await (await withAuth(clerkUserId, () => GET())).json();
  expect(second).toEqual(first);
  expect(await adminDb().$count(users)).toBe(1);
});

test("one user's identity response never contains another's", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await (await withAuth(clerkA, () => GET())).json();
  const responseB = await withAuth(clerkB, () => GET());
  const rawB = await responseB.text();

  expect(JSON.parse(rawB).id).not.toBe(a.id);
  expect(rawB).not.toContain(a.id);
  expect(rawB).not.toContain(clerkA);
});
