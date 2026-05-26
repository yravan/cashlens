import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { clerkEnabled } from "@/lib/runtime";

const noOpProxy = () => NextResponse.next();
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/accounts(.*)", "/transactions(.*)", "/settings(.*)", "/api/proxy(.*)"]);

export default clerkEnabled
  ? clerkMiddleware(
      async (auth, req) => {
        if (isProtectedRoute(req)) {
          await auth.protect();
        }
      },
    )
  : noOpProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
