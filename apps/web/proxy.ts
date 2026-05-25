import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { clerkEnabled } from "@/lib/runtime";

const noOpProxy = () => NextResponse.next();

export default clerkEnabled ? clerkMiddleware() : noOpProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
