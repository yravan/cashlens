import fs from "node:fs";
import { expect, test } from "@playwright/test";

import { E2E_USERS_FILE, STORAGE_STATE_B } from "../playwright.config";
import { adminQuery, appQuery, appQueryScopedAs } from "./db";

const PROBE_A = "user_rls_probe_a";
const PROBE_B = "user_rls_probe_b";

// page.request through a real page, never file-sourced request contexts:
// static storage-state cookies go stale mid-suite (see plaid.signed-in.spec.ts).
test("a signed-in user can never read another user's identity", async ({
  browser,
  page,
  baseURL,
}) => {
  await page.goto("/");
  const responseA = await page.request.get("/api/me");
  expect(responseA.status()).toBe(200);
  const a = await responseA.json();

  const contextB = await browser.newContext({
    baseURL,
    storageState: STORAGE_STATE_B,
  });
  try {
    const pageB = await contextB.newPage();
    await pageB.goto("/");
    const responseB = await pageB.request.get("/api/me");
    expect(responseB.status()).toBe(200);
    const b = await responseB.json();

    const users = JSON.parse(fs.readFileSync(E2E_USERS_FILE, "utf8"));
    expect(b.id).not.toBe(a.id);
    const rawB = JSON.stringify(b);
    expect(rawB).not.toContain(a.id);
    expect(rawB).not.toContain(users.a.clerkUserId);
    expect(rawB).not.toContain(users.a.email);
  } finally {
    await contextB.close();
  }
});

test.describe("row-level security backstop", () => {
  test.beforeAll(async () => {
    await adminQuery(
      "insert into users (clerk_user_id) values ($1), ($2) on conflict (clerk_user_id) do nothing",
      [PROBE_A, PROBE_B],
    );
  });

  test.afterAll(async () => {
    await adminQuery("delete from users where clerk_user_id in ($1, $2)", [
      PROBE_A,
      PROBE_B,
    ]);
  });

  test("an app-role query with no WHERE clause sees only the scoped user's rows", async () => {
    const scoped = await appQueryScopedAs(
      PROBE_A,
      "select clerk_user_id from users",
    );
    expect(scoped.rows).toEqual([{ clerk_user_id: PROBE_A }]);
  });

  test("an app-role connection with no request scope sees zero rows", async () => {
    const admin = await adminQuery("select count(*)::int as n from users");
    expect(admin.rows[0].n).toBeGreaterThanOrEqual(2);

    const unscoped = await appQuery("select * from users");
    expect(unscoped.rowCount).toBe(0);
  });

  test("the app role cannot insert a row for a different user", async () => {
    await expect(
      appQueryScopedAs(PROBE_A, "insert into users (clerk_user_id) values ($1)", [
        `${PROBE_B}_forged`,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("the app role has no update or delete path on identity rows", async () => {
    await expect(
      appQueryScopedAs(PROBE_A, "update users set clerk_user_id = $1", [
        "overwritten",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      appQueryScopedAs(PROBE_A, "delete from users"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  test("every application table has forced row-level security", async () => {
    const unprotected = await appQuery(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not (c.relrowsecurity and c.relforcerowsecurity)`,
    );
    expect(unprotected.rows).toEqual([]);
  });
});
