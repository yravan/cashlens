import { expect, test } from "@playwright/test";

test("every response carries the production security headers", async ({
  request,
}) => {
  const response = await request.get("/sign-in", { maxRedirects: 0 });
  expect(response.status()).toBe(200);

  const headers = response.headers();
  expect(headers["strict-transport-security"]).toBe(
    "max-age=63072000; includeSubDomains",
  );
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("robots.txt forbids all crawling", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("User-Agent: *");
  expect(body).toContain("Disallow: /");
  expect(body).not.toContain("Allow:");
});
