import fs from "node:fs";
import { expect, test } from "@playwright/test";

import { E2E_USERS_FILE } from "../playwright.config";
import { adminQuery } from "./db";

function clerkIdOf(key: "a" | "b"): string {
  return JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"))[key].clerkUserId;
}

test("first authenticated page visit creates exactly one user record", async ({
  page,
}) => {
  const clerkId = clerkIdOf("a");
  await adminQuery("delete from users where clerk_user_id = $1", [clerkId]);

  await page.goto("/");
  await expect(page.getByTestId("signed-in-email")).toBeVisible();

  const rows = await adminQuery(
    "select id, created_at from users where clerk_user_id = $1",
    [clerkId],
  );
  expect(rows.rowCount).toBe(1);
  expect(rows.rows[0].id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

// page.request, never the standalone request fixture: static storage-state
// cookies go stale mid-suite (see the note in plaid.signed-in.spec.ts), and a
// bounced request reads as an HTML sign-in page.
test("provisioning is idempotent across repeated and concurrent requests", async ({
  page,
}) => {
  const clerkId = clerkIdOf("a");
  await page.goto("/");
  await adminQuery("delete from users where clerk_user_id = $1", [clerkId]);

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => page.request.get("/api/me")),
  );
  for (const response of responses) expect(response.status()).toBe(200);
  const ids = new Set<string>();
  for (const response of responses) ids.add((await response.json()).id);
  expect(ids.size).toBe(1);

  const repeat = await page.request.get("/api/me");
  expect((await repeat.json()).id).toBe([...ids][0]);

  const count = await adminQuery(
    "select count(*)::int as n from users where clerk_user_id = $1",
    [clerkId],
  );
  expect(count.rows[0].n).toBe(1);
});

test("/api/me returns the caller's identity record and nothing more", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.get("/api/me");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["createdAt", "id"]);

  const row = await adminQuery(
    "select id from users where clerk_user_id = $1",
    [clerkIdOf("a")],
  );
  expect(body.id).toBe(row.rows[0].id);
});
