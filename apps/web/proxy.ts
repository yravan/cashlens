import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

// Only the auth pages are public. Everything else requires a session:
// public is the exception, never the default.
const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

function isPublicRoute(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;
    const { isAuthenticated, redirectToSignIn } = await auth();
    if (!isAuthenticated) {
      // redirectToSignIn() redirects every kind of request deterministically,
      // where auth.protect() would 404 non-document requests. This proxy is
      // only an optimistic first gate: after CVE-2025-29927 (middleware
      // bypass), pages and route handlers must re-check auth themselves.
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  },
  // Pin auth page URLs in code: the Node-runtime proxy can miss NEXT_PUBLIC_*
  // env vars at runtime (clerk/javascript#8302).
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
