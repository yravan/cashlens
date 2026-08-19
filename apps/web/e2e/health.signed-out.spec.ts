import { expect, test } from "@playwright/test";

test("health endpoint reports ok without authentication", async ({
  request,
}) => {
  const response = await request.get("/api/health", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});
