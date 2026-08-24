import { auth } from "@clerk/nextjs/server";

// Route handlers get no CSRF protection (unlike server actions) and Clerk's session
// rides on cookies. Browsers always attach Origin to cross-site fetch/form POSTs;
// absence means a non-browser client.
function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

export async function guardPost(request: Request): Promise<Response | null> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (crossOrigin(request)) return Response.json({ error: "cross_origin" }, { status: 403 });
  return null;
}
