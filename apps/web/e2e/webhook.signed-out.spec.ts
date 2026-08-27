import { expect, test } from "@playwright/test";

const CONFIGURED =
  !!process.env.PLAID_CLIENT_ID &&
  !!process.env.PLAID_SECRET &&
  process.env.PLAID_ENV === "sandbox";

const forgedJwt = () => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "ES256", typ: "JWT", kid: "e2e-kid-plaid-never-issued" });
  const payload = encode({
    iat: Math.floor(Date.now() / 1000),
    request_body_sha256: "0".repeat(64),
  });
  return `${header}.${payload}.${"A".repeat(86)}`;
};

test.describe("plaid webhook endpoint (public, self-authenticating)", () => {
  test("reachable with no session, but a delivery without a signature is 401 — never a sign-in redirect", async ({
    request,
  }) => {
    const response = await request.post("/api/plaid/webhook", {
      data: { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-x" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unverified" });
  });

  test("a forged signature is rejected through the real key-fetch path", async ({ request }) => {
    test.skip(!CONFIGURED, "PLAID_* sandbox keys not configured");
    const response = await request.post("/api/plaid/webhook", {
      headers: { "plaid-verification": forgedJwt(), "content-type": "application/json" },
      data: "{}",
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "unverified" });
  });

  test("the endpoint answers POST only", async ({ request }) => {
    const response = await request.get("/api/plaid/webhook", { maxRedirects: 0 });
    expect(response.status()).toBe(405);
  });
});
