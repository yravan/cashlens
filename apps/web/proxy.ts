import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/api/health", "/robots.txt"];

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
    // redirectToSignIn 307s every request type where auth.protect() would 404
    // non-document ones. Optimistic gate only (CVE-2025-29927): every page and
    // route handler re-checks auth() itself.
    if (!isAuthenticated) return redirectToSignIn({ returnBackUrl: req.url });
  },
  // In code, not env: the proxy can miss NEXT_PUBLIC_* (clerk/javascript#8302).
  {
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
    // Set in production: rejects session tokens minted for another origin.
    ...(process.env.APP_ORIGIN
      ? { authorizedParties: [process.env.APP_ORIGIN] }
      : {}),
  },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
