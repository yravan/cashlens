import type { Page } from "@playwright/test";

import { adminQuery } from "./db";
import { expect } from "./fixtures";

async function credentialedConnections(clerkUserId: string): Promise<Array<{ id: string; status: string }>> {
  const result = await adminQuery(
    `select c.id, c.status
       from connections c
       join connection_credentials cc on cc.connection_id = c.id
      where c.user_id in (select id from users where clerk_user_id = $1)
      order by c.id`,
    [clerkUserId],
  );
  return result.rows;
}

export async function cleanupSandboxRows(clerkUserId: string) {
  if ((await credentialedConnections(clerkUserId)).length !== 0) {
    throw new Error("refusing to delete a connection before provider cleanup");
  }
  await adminQuery(
    `with mine as (select id from users where clerk_user_id = $1),
          cleared as (delete from accounts where user_id in (select id from mine))
     delete from connections where user_id in (select id from mine)`,
    [clerkUserId],
  );
}

export async function disconnectSandboxItems(page: Page, clerkUserId: string) {
  const credentialed = await credentialedConnections(clerkUserId);
  const unsupported = credentialed.filter(({ status }) => status !== "active");
  if (unsupported.length !== 0) {
    throw new Error(`refusing to clean up ${unsupported.length} credentialed connections in unsupported states`);
  }
  for (const { id } of credentialed) {
    let response = await page.request.post(`/api/connections/${id}/disconnect`, {
      data: { purge: true },
      maxRedirects: 0,
    });
    if ([307, 308, 401].includes(response.status())) {
      await page.goto("/accounts", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
      response = await page.request.post(`/api/connections/${id}/disconnect`, {
        data: { purge: true },
        maxRedirects: 0,
      });
    }
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ disconnected: true });
  }
}
