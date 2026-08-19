import { expect, test } from "@playwright/test";

test("GATE DEMO: deliberately red, reverted in the next commit", async ({ request }) => {
  const response = await request.get("/api/me");
  expect(response.status()).toBe(418);
});
