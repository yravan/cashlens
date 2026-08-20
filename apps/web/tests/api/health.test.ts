import { expect, test } from "vitest";

import { GET } from "@/app/api/health/route";

test("health reports ok when the database answers", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok", db: "ok" });
});
