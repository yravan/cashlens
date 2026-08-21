import { expect, test } from "vitest";

import { requireUser } from "@/lib/data/users";
import { users } from "@/lib/db/schema";
import { fakeClerkUserId, withAuth } from "../harness/clerk";
import { adminDb } from "../harness/db";

test("requireUser signed out redirects to sign-in instead of returning data", async () => {
  await expect(requireUser()).rejects.toMatchObject({
    digest: expect.stringContaining("/sign-in"),
  });
  expect(await adminDb().$count(users)).toBe(0);
});

test("concurrent first sign-ins race to exactly one row and one identity", async () => {
  const clerkUserId = fakeClerkUserId();
  const [first, second] = await Promise.all([
    withAuth(clerkUserId, () => requireUser()),
    withAuth(clerkUserId, () => requireUser()),
  ]);
  expect(first.id).toBe(second.id);
  expect(first.clerkUserId).toBe(clerkUserId);
  expect(await adminDb().$count(users)).toBe(1);
});

test("requireUser returns the caller's row, never a pre-existing other user", async () => {
  const clerkA = fakeClerkUserId();
  const clerkB = fakeClerkUserId();
  const a = await withAuth(clerkA, () => requireUser());
  const b = await withAuth(clerkB, () => requireUser());

  expect(a.clerkUserId).toBe(clerkA);
  expect(b.clerkUserId).toBe(clerkB);
  expect(b.id).not.toBe(a.id);
});
