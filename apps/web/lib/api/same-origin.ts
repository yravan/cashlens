// Route handlers have no built-in CSRF protection (unlike server actions), and
// Clerk's session rides on cookies. Browsers always attach Origin to
// cross-site fetch/form POSTs; absence means a non-browser client.
export function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}
