export const API_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@cashlens.local";

const clerkKeysPresent =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && Boolean(process.env.CLERK_SECRET_KEY);

const explicitClerkFlag = process.env.ENABLE_CLERK;

export const clerkEnabled =
  explicitClerkFlag !== undefined
    ? explicitClerkFlag.toLowerCase() === "true" && clerkKeysPresent
    : process.env.NODE_ENV === "production" && clerkKeysPresent;
