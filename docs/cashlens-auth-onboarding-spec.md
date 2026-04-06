# CashLens — Auth, Onboarding & Auto-Sync Implementation Spec

**Document Status:** Implementation-Ready Spec for Claude Code  
**Last Updated:** April 6, 2026  
**Parent Document:** `docs/spec-v4.md`  
**Scope:** Wire up Clerk auth end-to-end, build the landing → sign-in → dashboard → onboarding → auto-sync flow. All data user-scoped.

---

## 1. Current State (What Exists Today)

Before writing any code, here's an honest audit of what's built and what's missing.

### 1.1 What's Built

| Component | Status | Location |
|---|---|---|
| **Backend: FastAPI server** | Working | `backend/app/main.py` |
| **Backend: Teller provider** | Working (sandbox tested) | `backend/app/providers/teller.py` |
| **Backend: SimpleFIN provider** | Working | `backend/app/providers/simplefin.py` |
| **Backend: Gmail receipt provider** | Scaffolded | `backend/app/providers/gmail_receipts.py` |
| **Backend: CSV/OFX import** | Working | `backend/app/providers/csv_import.py`, `ofx_import.py` |
| **Backend: Camera receipt scan** | Working | `backend/app/providers/camera_scan.py` |
| **Backend: DB models (17 tables)** | Working, migrated | `backend/app/models/` |
| **Backend: Sync service** | Working | `backend/app/services/ingestion/sync_service.py` |
| **Backend: APScheduler** | Working | `backend/app/services/ingestion/scheduler.py` |
| **Backend: Encryption util** | Working | `backend/app/core/encryption.py` |
| **Frontend: Next.js 15 + shadcn/ui** | Working | `frontend/` |
| **Frontend: Dashboard layout** | Working (sidebar, header, pages) | `frontend/src/app/(dashboard)/` |
| **Frontend: Dashboard page** | Working (KPI cards, charts) | `frontend/src/app/(dashboard)/page.tsx` |
| **Frontend: Transactions page** | Scaffolded | `frontend/src/app/(dashboard)/transactions/page.tsx` |
| **Frontend: Review page** | Scaffolded | `frontend/src/app/(dashboard)/review/page.tsx` |
| **Frontend: Settings page** | Scaffolded | `frontend/src/app/(dashboard)/settings/page.tsx` |
| **Frontend: React Query + Sonner + next-themes** | Wired up | `frontend/src/components/layout/providers.tsx` |
| **Package: `@clerk/nextjs`** | Installed (v6) | `frontend/package.json` |

### 1.2 What's Missing (This Spec Covers)

| Gap | Impact |
|---|---|
| **No Clerk wired up anywhere** | `ClerkProvider` not in layout. No `middleware.ts`. No `<SignIn/>` page. No JWT validation on backend. |
| **`USER_ID = "default"` hardcoded** | `backend/app/api/routes/ingestion.py` line 18, `backend/app/api/routes/data.py` line 12. Every user shares the same data. |
| **No landing / home page** | Root `page.tsx` is a raw Teller debug page, not a real landing page. |
| **No sign-in / sign-up pages** | Clerk components not mounted anywhere. |
| **No onboarding / setup flow** | No guided "connect your bank" or "connect Gmail" experience after first sign-in. |
| **No auth middleware (frontend)** | All `(dashboard)` routes are publicly accessible. |
| **No auth middleware (backend)** | No Clerk JWT validation. Any HTTP client can hit any endpoint. |
| **Backend CORS too permissive** | `allow_origins=["http://localhost:3000"]` — fine for dev but needs Clerk domain awareness. |
| **No user-scoped provider connections** | `save_bank_connection` takes `USER_ID` but it's always `"default"`. |
| **Gmail OAuth not user-scoped** | `gmail_credentials.json` is a global file path, not per-user. |

---

## 2. Target Architecture

After this spec is implemented, the user journey is:

```
                    ┌──────────────────┐
                    │   Landing Page   │  ← "/" (public)
                    │   (marketing)    │
                    └────────┬─────────┘
                             │ click "Get Started" / "Sign In"
                             ▼
                    ┌──────────────────┐
                    │   Clerk Sign-In  │  ← "/sign-in" (public)
                    │   <SignIn />     │
                    └────────┬─────────┘
                             │ authenticated
                             ▼
                    ┌──────────────────┐
              ┌─────│   Onboarding     │  ← "/setup" (protected)
              │     │   Check          │
              │     └────────┬─────────┘
              │              │
         needs setup    already set up
              │              │
              ▼              ▼
     ┌─────────────┐  ┌──────────────┐
     │   Setup     │  │  Dashboard   │  ← "/" redirects here if authed
     │   Wizard    │  │              │
     │             │  │  (all data   │
     │  Step 1:    │  │   scoped to  │
     │  Teller     │  │   user_id)   │
     │             │  │              │
     │  Step 2:    │  └──────────────┘
     │  Gmail      │
     │             │
     │  Step 3:    │
     │  Done! →    │──────────────────► Dashboard
     └─────────────┘
```

### 2.1 Route Map

| Route | Auth | Purpose |
|---|---|---|
| `/` | Public | Landing page (marketing). If user is already signed in, redirect to `/dashboard`. |
| `/sign-in` | Public | Clerk `<SignIn />` component. |
| `/sign-up` | Public | Clerk `<SignUp />` component. |
| `/setup` | Protected | Onboarding wizard (Teller → Gmail → Done). Shown only if user has zero bank connections. |
| `/dashboard` | Protected | Main dashboard (moved from current `/(dashboard)/page.tsx`). |
| `/dashboard/transactions` | Protected | Transaction list. |
| `/dashboard/review` | Protected | Review queue. |
| `/dashboard/scanner` | Protected | Receipt scanner. |
| `/dashboard/events` | Protected | Events. |
| `/dashboard/reports` | Protected | Reports. |
| `/dashboard/chat` | Protected | AI chat. |
| `/dashboard/settings` | Protected | Settings (including re-connect bank, re-connect Gmail). |

### 2.2 Key Principle: User Scoping

Every row of user data in the database is scoped by `user_id`, which is the Clerk user ID (`user_2abc123...`). This value:

- **Frontend:** Comes from `useAuth()` hook or `auth()` server function (Clerk).
- **Backend:** Extracted from the validated Clerk JWT's `sub` claim. Passed to every DB query.
- **Never hardcoded.** The string `"default"` must not appear anywhere in the codebase after this spec is implemented.

---

## 3. Implementation Plan

### 3.1 Backend: Clerk JWT Auth Middleware

**Install dependency:**
```bash
pip install fastapi-clerk-auth
```

**Add to `pyproject.toml` and `requirements.txt`:**
```
fastapi-clerk-auth
```

**Add to `.env`:**
```env
CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
# OR — fastapi-clerk-auth can also use CLERK_SECRET_KEY to fetch JWKS automatically
```

**Add to `backend/app/core/config.py`:**
```python
# Clerk
clerk_secret_key: str = ""
clerk_jwks_url: str = ""  # e.g. https://your-app.clerk.accounts.dev/.well-known/jwks.json
```

**Create `backend/app/api/deps.py`:**
```python
"""Shared FastAPI dependencies — auth, DB session."""

from fastapi import Depends
from fastapi_clerk_auth import ClerkConfig, ClerkHTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db

# ── Clerk auth ──
clerk_config = ClerkConfig(jwks_url=settings.clerk_jwks_url)
clerk_auth = ClerkHTTPBearer(config=clerk_config)


async def get_current_user_id(credentials=Depends(clerk_auth)) -> str:
    """Extract the Clerk user_id from a validated JWT."""
    return credentials.decoded["sub"]
```

**Update every route file** — replace `USER_ID = "default"` with the dependency:

```python
# BEFORE (in ingestion.py, data.py, etc.)
USER_ID = "default"

@router.post("/connect/teller")
async def connect_teller(access_token: str, db: AsyncSession = Depends(get_db)):
    connection = await save_bank_connection(db, USER_ID, ...)

# AFTER
from app.api.deps import get_current_user_id

@router.post("/connect/teller")
async def connect_teller(
    access_token: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    connection = await save_bank_connection(db, user_id, ...)
```

**Every route** in `ingestion.py` and `data.py` (and any future route files) MUST use `user_id: str = Depends(get_current_user_id)`. There are no exceptions.

**Add an "onboarding status" endpoint:**

```python
# backend/app/api/routes/onboarding.py

@router.get("/onboarding/status")
async def onboarding_status(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Returns what the user has set up so far."""
    bank_connections = await db.execute(
        select(BankConnection)
        .where(BankConnection.user_id == user_id, BankConnection.status == "active")
    )
    has_bank = bank_connections.scalars().first() is not None

    # Check if Gmail is connected (user has a stored OAuth token)
    has_gmail = await check_gmail_connected(db, user_id)

    accounts_count = await db.scalar(
        select(func.count()).select_from(Account)
        .where(Account.user_id == user_id, Account.is_active == True)
    )
    transactions_count = await db.scalar(
        select(func.count()).select_from(Transaction)
        .where(Transaction.user_id == user_id)
    )

    return {
        "has_bank_connection": has_bank,
        "has_gmail": has_gmail,
        "accounts_count": accounts_count,
        "transactions_count": transactions_count,
        "setup_complete": has_bank,  # bank is required; Gmail is optional
    }
```

Register the router in `main.py`:
```python
from app.api.routes.onboarding import router as onboarding_router
app.include_router(onboarding_router, prefix="/api")
```

### 3.2 Backend: User-Scoped Gmail OAuth

Currently `gmail_credentials.json` and `gmail_token.pickle` are global file paths. For multi-user support, Gmail OAuth tokens need to be stored per-user in the database.

**Create a new model in `backend/app/models/infrastructure.py`:**

```python
class UserOAuthToken(TimestampMixin, Base):
    __tablename__ = "user_oauth_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)  # "gmail"
    encrypted_token_data: Mapped[str] = mapped_column(Text, nullable=False)  # AES-256-GCM JSON blob
    scopes: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text))
    email_address: Mapped[Optional[str]] = mapped_column(Text)  # for display in UI
    expires_at: Mapped[Optional[datetime]] = mapped_column()

    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_user_oauth_provider"),
    )
```

**Create Gmail OAuth endpoints in `backend/app/api/routes/gmail_auth.py`:**

```python
@router.get("/auth/gmail")
async def gmail_auth_start(
    user_id: str = Depends(get_current_user_id),
):
    """Generate the Google OAuth URL and return it. Frontend redirects the user."""
    flow = google_auth_oauthlib.flow.Flow.from_client_config(
        GMAIL_CLIENT_CONFIG,
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        redirect_uri=f"{settings.api_base_url}/api/auth/gmail/callback",
    )
    # Store user_id in state so we know who's connecting on callback
    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=encrypt_state(user_id),
    )
    return {"auth_url": auth_url}


@router.get("/auth/gmail/callback")
async def gmail_auth_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Google redirects here after user consents. Store tokens, redirect to frontend."""
    user_id = decrypt_state(state)
    flow = ...  # reconstruct flow
    flow.fetch_token(code=code)
    credentials = flow.credentials

    # Encrypt and store per-user
    token_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes),
    }
    encrypted = encrypt(json.dumps(token_data))

    # Upsert into user_oauth_tokens
    await upsert_oauth_token(db, user_id, "gmail", encrypted, credentials.expiry)

    # Redirect to frontend setup page
    return RedirectResponse(f"{settings.frontend_url}/setup?gmail=connected")


@router.delete("/auth/gmail")
async def gmail_disconnect(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Revoke Gmail access."""
    await delete_oauth_token(db, user_id, "gmail")
    return {"status": "disconnected"}
```

**Update Gmail receipt scraper** to load credentials from `user_oauth_tokens` table instead of a file path.

### 3.3 Backend: Teller Connect Token Storage

The Teller flow works like this:

1. Frontend opens Teller Connect widget (JavaScript).
2. User authenticates with their bank inside the widget.
3. Widget fires `onSuccess` callback with an `enrollment.accessToken`.
4. Frontend POSTs the access token to our backend.
5. Backend stores it (encrypted) and runs the initial sync.

The current `POST /api/ingestion/connect/teller` endpoint already handles steps 4–5. It just needs the `user_id` from Clerk auth instead of `"default"`.

No structural changes needed — just wire up the auth dependency as described in §3.1.

### 3.4 Backend: Auto-Sync Scheduler (User-Scoped)

The current `scheduler.py` needs to sync **all active users' connections**, not just one hardcoded user.

**Update `backend/app/services/ingestion/scheduler.py`:**

```python
async def sync_all_bank_connections():
    """Called by APScheduler every 6 hours. Syncs every active bank connection for every user."""
    async with async_session() as db:
        connections = await db.execute(
            select(BankConnection).where(BankConnection.status == "active")
        )
        for conn in connections.scalars().all():
            try:
                await sync_connection(db, conn)
                logger.info("Synced connection", extra={"connection_id": str(conn.id), "user_id": conn.user_id})
            except Exception:
                logger.exception("Sync failed", extra={"connection_id": str(conn.id)})


async def scrape_all_gmail_receipts():
    """Called by APScheduler every 15 minutes. Scrapes Gmail for every user with Gmail connected."""
    async with async_session() as db:
        tokens = await db.execute(
            select(UserOAuthToken).where(UserOAuthToken.provider == "gmail")
        )
        for token in tokens.scalars().all():
            try:
                creds = decrypt_and_build_credentials(token.encrypted_token_data)
                await scrape_gmail_for_user(db, token.user_id, creds)
            except Exception:
                logger.exception("Gmail scrape failed", extra={"user_id": token.user_id})
```

### 3.5 Frontend: Clerk Integration

**Step 1 — Create `frontend/src/middleware.ts`:**

This is the most important file. Clerk's Next.js middleware protects routes and handles redirects.

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes (no auth required)
const isPublicRoute = createRouteMatcher([
  "/",                    // Landing page
  "/sign-in(.*)",         // Clerk sign-in
  "/sign-up(.*)",         // Clerk sign-up
  "/api/webhooks/(.*)",   // Clerk webhooks
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();  // Redirects to /sign-in if not authenticated
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

**Step 2 — Add `ClerkProvider` to the root layout:**

Update `frontend/src/app/layout.tsx`:

```tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning className={cn("font-sans", geistSans.variable, geistMono.variable)}>
        <body className="antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

**Step 3 — Create sign-in / sign-up pages:**

`frontend/src/app/sign-in/[[...sign-in]]/page.tsx`:
```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn afterSignInUrl="/setup" afterSignUpUrl="/setup" />
    </div>
  );
}
```

`frontend/src/app/sign-up/[[...sign-up]]/page.tsx`:
```tsx
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp afterSignUpUrl="/setup" afterSignInUrl="/setup" />
    </div>
  );
}
```

**Step 4 — Add `UserButton` to the sidebar:**

Update `frontend/src/components/layout/app-sidebar.tsx` footer:

```tsx
import { UserButton } from "@clerk/nextjs";

// In the SidebarFooter:
<SidebarFooter>
  <SidebarMenu>
    <SidebarMenuItem>
      <div className="flex items-center gap-2 px-2">
        <UserButton afterSignOutUrl="/" />
        <ThemeToggle />
      </div>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarFooter>
```

**Step 5 — Wire up auth token on all API calls:**

Create `frontend/src/lib/api.ts`:

```typescript
import { useAuth } from "@clerk/nextjs";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useApiClient() {
  const { getToken } = useAuth();

  async function apiFetch(path: string, options: RequestInit = {}) {
    const token = await getToken();
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  return { apiFetch };
}
```

**Every existing React Query hook** (`use-get-accounts.ts`, `use-get-summary.ts`, `use-get-transactions.ts`) must be updated to use `useApiClient()` with the Bearer token. Currently they likely use plain `fetch` without auth headers.

### 3.6 Frontend: Landing Page (`/`)

Replace the current root `page.tsx` (Teller debug page) with a real landing page.

**`frontend/src/app/page.tsx`** (complete rewrite):

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          CashLens
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          LLM-powered personal finance. Every dollar tracked, categorized, and
          accounted for — automatically.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Get Started
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border px-6 py-3 text-sm font-semibold shadow-sm hover:bg-accent"
          >
            Sign In
          </Link>
        </div>
      </div>
    </main>
  );
}
```

### 3.7 Frontend: Setup / Onboarding Wizard (`/setup`)

This is the core new screen. After signing in (or signing up), the user lands here. If they've already completed setup, they get redirected to `/dashboard`.

**`frontend/src/app/setup/page.tsx`:**

The wizard has 3 steps:

1. **Connect Bank (Teller)** — Required. Opens Teller Connect widget, receives access token, POSTs to backend.
2. **Connect Gmail** — Optional. Redirects to Google OAuth, comes back with `?gmail=connected`.
3. **Done** — Shows sync status, redirects to dashboard.

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiClient } from "@/lib/api";
import { CheckCircle, Loader2, Mail, Building2, ArrowRight, SkipForward } from "lucide-react";

type OnboardingStatus = {
  has_bank_connection: boolean;
  has_gmail: boolean;
  accounts_count: number;
  transactions_count: number;
  setup_complete: boolean;
};

const TELLER_APP_ID = process.env.NEXT_PUBLIC_TELLER_APP_ID || "";
const TELLER_ENV = process.env.NEXT_PUBLIC_TELLER_ENV || "sandbox";

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { apiFetch } = useApiClient();

  const [step, setStep] = useState(1); // 1=bank, 2=gmail, 3=done
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Check onboarding status on mount
  useEffect(() => {
    apiFetch("/api/onboarding/status").then((data: OnboardingStatus) => {
      setStatus(data);
      if (data.setup_complete) {
        // Already set up — skip to dashboard or advance step
        if (data.has_gmail || searchParams.get("gmail") === "connected") {
          setStep(3);
        } else {
          setStep(2);
        }
      }
    });
  }, []);

  // Handle Gmail callback
  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      setStep(3);
    }
  }, [searchParams]);

  // ── Step 1: Connect Bank via Teller ──
  async function handleTellerConnect() {
    // Dynamically load Teller Connect script
    if (!(window as any).TellerConnect) {
      const script = document.createElement("script");
      script.src = "https://cdn.teller.io/connect/connect.js";
      script.onload = () => openTellerWidget();
      document.head.appendChild(script);
    } else {
      openTellerWidget();
    }
  }

  function openTellerWidget() {
    const teller = (window as any).TellerConnect.setup({
      applicationId: TELLER_APP_ID,
      environment: TELLER_ENV,
      onSuccess: async (enrollment: any) => {
        setSyncing(true);
        setError("");
        try {
          const result = await apiFetch(
            `/api/ingestion/connect/teller?access_token=${encodeURIComponent(enrollment.accessToken)}`,
            { method: "POST" }
          );
          setSyncResult(
            `Connected! ${result.accounts_synced ?? 0} accounts, ${result.transactions_synced ?? 0} transactions synced.`
          );
          setStep(2); // advance to Gmail
        } catch (e: any) {
          setError(e.message);
        } finally {
          setSyncing(false);
        }
      },
      onFailure: (failure: any) => {
        setError(`Connection failed: ${failure.message || "Unknown error"}`);
      },
      onExit: () => {},
    });
    teller.open();
  }

  // ── Step 2: Connect Gmail ──
  async function handleGmailConnect() {
    try {
      const data = await apiFetch("/api/auth/gmail");
      // Redirect to Google OAuth consent screen
      window.location.href = data.auth_url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  // ── Step 3: Done ──
  function handleFinish() {
    router.push("/dashboard");
  }

  // ── Render ──
  // (Wizard UI with 3 step indicators at top, content below.)
  // Step 1: Bank icon + "Connect your bank account" + Teller button + loading state
  // Step 2: Gmail icon + "Connect Gmail for receipt matching" + Connect button + Skip button
  // Step 3: Checkmark + "You're all set!" + transaction count + "Go to Dashboard" button
  // ... (full JSX implementation left to Claude Code, but the logic above is the contract)
}
```

**Key UX details for the wizard:**

- **Step indicators** at the top: three circles connected by lines, filled when complete. Use the shadcn `Badge` or custom SVG.
- **Step 1 (Bank)** is required. The "Next" button is disabled until a bank is connected. Show a loading spinner during sync with the message "Syncing your accounts... this takes about 10 seconds."
- **Step 2 (Gmail)** is optional. Show both "Connect Gmail" and "Skip for now" buttons. The skip button advances to step 3.
- **Step 3 (Done)** shows a celebration state: checkmark icon, "You're all set!", account count, transaction count, and a big "Go to Dashboard" button.
- If the user navigates away mid-setup and comes back, the `GET /api/onboarding/status` endpoint tells the wizard which step to resume at.

### 3.8 Frontend: Route Group Restructure

**Current structure:**
```
src/app/
├── page.tsx                          ← Teller debug page (REPLACE with landing)
├── layout.tsx                        ← Root layout (ADD ClerkProvider)
└── (dashboard)/
    ├── layout.tsx                    ← Sidebar layout (KEEP)
    ├── page.tsx                      ← Dashboard (KEEP)
    ├── transactions/page.tsx
    ├── review/page.tsx
    └── settings/page.tsx
```

**Target structure:**
```
src/app/
├── page.tsx                          ← Landing page (public, redirects if authed)
├── layout.tsx                        ← Root layout (with ClerkProvider)
├── sign-in/[[...sign-in]]/page.tsx   ← Clerk SignIn
├── sign-up/[[...sign-up]]/page.tsx   ← Clerk SignUp
├── setup/page.tsx                    ← Onboarding wizard (protected)
├── (dashboard)/
│   ├── layout.tsx                    ← Sidebar layout (KEEP as-is)
│   ├── page.tsx                      ← Dashboard home
│   ├── transactions/page.tsx
│   ├── review/page.tsx
│   ├── scanner/page.tsx
│   ├── events/page.tsx
│   ├── reports/page.tsx
│   ├── chat/page.tsx
│   └── settings/page.tsx
└── middleware.ts                      ← Clerk route protection
```

The `(dashboard)` route group is already protected by the middleware (since it's not in the `isPublicRoute` list). No changes needed to the dashboard layout itself.

### 3.9 Frontend: Dashboard Redirect Logic

The `(dashboard)/layout.tsx` should check if the user has completed onboarding. If not, redirect to `/setup`.

```tsx
// frontend/src/app/(dashboard)/layout.tsx

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  // Check onboarding status
  const token = await getToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/onboarding/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const status = await res.json();
    if (!status.setup_complete) redirect("/setup");
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

**Performance note:** This `fetch` runs on every dashboard page load (server-side). To avoid hitting the backend on every navigation, cache the result in a cookie or use `unstable_cache` with a short TTL (e.g., 5 minutes). After the user completes setup, the cookie is set and the check is skipped.

### 3.10 Environment Variables

**Frontend `.env.local`** (add these):
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/setup
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/setup
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_TELLER_APP_ID=app_...
NEXT_PUBLIC_TELLER_ENV=sandbox
```

**Backend `.env`** (add these):
```env
CLERK_JWKS_URL=https://your-app.clerk.accounts.dev/.well-known/jwks.json
CLERK_SECRET_KEY=sk_test_...
FRONTEND_URL=http://localhost:3000
API_BASE_URL=http://localhost:8000
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
```

---

## 4. Data Flow: End-to-End Sync

Once the user completes onboarding, here's what happens automatically:

```
User completes Step 1 (Teller Connect)
│
├──► Frontend receives enrollment.accessToken
├──► Frontend POSTs to /api/ingestion/connect/teller (with Clerk JWT)
├──► Backend extracts user_id from JWT
├──► Backend encrypts access_token, creates BankConnection row
├──► Backend calls TellerProvider.fetch_accounts() + fetch_transactions()
├──► Backend inserts Accounts and Transactions scoped to user_id
├──► Backend returns { accounts_synced, transactions_synced }
│
│    From now on, APScheduler runs sync_all_bank_connections() every 6 hours:
│      → Loads all active BankConnections (all users)
│      → For each: decrypt token → fetch new transactions → insert to DB
│      → Each transaction gets user_id from its BankConnection.user_id
│
User completes Step 2 (Gmail OAuth)
│
├──► Frontend redirects to /api/auth/gmail
├──► Backend generates Google OAuth URL with user_id in state
├──► User authenticates with Google
├──► Google redirects to /api/auth/gmail/callback
├──► Backend decrypts state → gets user_id
├──► Backend stores encrypted OAuth tokens in user_oauth_tokens
├──► Backend redirects to frontend /setup?gmail=connected
│
│    From now on, APScheduler runs scrape_all_gmail_receipts() every 15 minutes:
│      → Loads all user_oauth_tokens where provider="gmail"
│      → For each: decrypt token → search Gmail → LLM parse → create Receipts
│      → Each receipt gets user_id from its UserOAuthToken.user_id
│
User reaches Dashboard
│
├──► Dashboard calls GET /api/data/accounts (with Clerk JWT)
├──► Backend filters: WHERE user_id = <clerk_user_id>
├──► Only this user's accounts returned
│
├──► Dashboard calls GET /api/data/transactions (with Clerk JWT)
├──► Backend filters: WHERE user_id = <clerk_user_id>
├──► Only this user's transactions returned
```

---

## 5. Migration Checklist

### 5.1 Database Migration

Create an Alembic migration for the new `user_oauth_tokens` table:

```bash
cd backend
alembic revision --autogenerate -m "add_user_oauth_tokens"
alembic upgrade head
```

### 5.2 Files to Create

| File | Purpose |
|---|---|
| `frontend/src/middleware.ts` | Clerk route protection |
| `frontend/src/app/sign-in/[[...sign-in]]/page.tsx` | Sign in page |
| `frontend/src/app/sign-up/[[...sign-up]]/page.tsx` | Sign up page |
| `frontend/src/app/setup/page.tsx` | Onboarding wizard |
| `frontend/src/lib/api.ts` | Auth-aware API client |
| `backend/app/api/deps.py` | Shared auth dependency |
| `backend/app/api/routes/onboarding.py` | Onboarding status endpoint |
| `backend/app/api/routes/gmail_auth.py` | Gmail OAuth endpoints |

### 5.3 Files to Modify

| File | Change |
|---|---|
| `frontend/src/app/layout.tsx` | Wrap with `<ClerkProvider>` |
| `frontend/src/app/page.tsx` | Replace Teller debug page with landing page |
| `frontend/src/app/(dashboard)/layout.tsx` | Add onboarding redirect check |
| `frontend/src/components/layout/app-sidebar.tsx` | Add `<UserButton />` to footer |
| `frontend/src/features/*/api/*.ts` | Add Bearer token to all API calls |
| `backend/app/api/routes/ingestion.py` | Replace `USER_ID = "default"` with `Depends(get_current_user_id)` |
| `backend/app/api/routes/data.py` | Replace `USER_ID = "default"` with `Depends(get_current_user_id)` |
| `backend/app/main.py` | Register onboarding + gmail_auth routers |
| `backend/app/core/config.py` | Add `clerk_jwks_url`, `frontend_url`, `api_base_url`, Gmail OAuth config |
| `backend/app/models/infrastructure.py` | Add `UserOAuthToken` model |
| `backend/app/models/__init__.py` | Export new model |
| `backend/app/services/ingestion/scheduler.py` | Make sync jobs iterate all users |
| `backend/app/providers/gmail_receipts.py` | Load credentials from DB instead of file path |
| `backend/requirements.txt` / `pyproject.toml` | Add `fastapi-clerk-auth` |
| `frontend/.env.example` | Add Clerk env vars |
| `backend/.env.example` | Add Clerk JWKS URL, frontend URL, Gmail OAuth client vars |

### 5.4 Files to Delete

| File | Reason |
|---|---|
| (none) | No files need to be deleted — the Teller debug page is being replaced in-place. |

---

## 6. Implementation Order

Build in this exact sequence. Each step is independently testable.

| Step | What | Test |
|---|---|---|
| **1** | Install `fastapi-clerk-auth`. Create `backend/app/api/deps.py`. Add `clerk_jwks_url` to config. | `curl -H "Authorization: Bearer <clerk_jwt>" http://localhost:8000/api/data/accounts` returns data. Without token → 401. |
| **2** | Replace `USER_ID = "default"` in `ingestion.py` and `data.py` with `Depends(get_current_user_id)`. | Same curl test — now returns only data for that Clerk user. |
| **3** | Add `ClerkProvider` to `layout.tsx`. Create `middleware.ts`. | Visit `/dashboard` while logged out → redirected to `/sign-in`. |
| **4** | Create `/sign-in` and `/sign-up` pages. | Can sign in via Clerk. Session persists. |
| **5** | Create `useApiClient` hook. Update all React Query hooks to use Bearer token. | Dashboard loads data after sign-in. No more unauthenticated API calls. |
| **6** | Add `<UserButton />` to sidebar. | User avatar shows in sidebar. Can sign out. |
| **7** | Rewrite root `page.tsx` as landing page. | Visit `/` logged out → landing page. Visit `/` logged in → redirect to `/dashboard`. |
| **8** | Create `GET /api/onboarding/status` endpoint. | Returns `{ has_bank_connection, has_gmail, setup_complete }`. |
| **9** | Create `/setup` page with Teller Connect step. | New user signs in → lands on `/setup` → connects bank → transactions sync. |
| **10** | Add `UserOAuthToken` model + migration. Create Gmail OAuth endpoints. Add Gmail step to setup wizard. | User connects Gmail in setup → token stored in DB → receipt scraping works. |
| **11** | Add onboarding redirect to `(dashboard)/layout.tsx`. | New user tries to go to `/dashboard` directly → redirected to `/setup`. |
| **12** | Update scheduler to iterate all users. | Scheduled sync picks up all users' connections. |

---

## 7. Security Considerations

| Concern | Mitigation |
|---|---|
| JWT spoofing | `fastapi-clerk-auth` validates JWTs against Clerk's JWKS endpoint (public key rotation handled automatically). |
| Token leakage | Teller access tokens and Gmail OAuth tokens encrypted with AES-256-GCM before DB storage. Encryption key in env var, never in code. |
| CORS | Update `allow_origins` to include the Clerk frontend domain and the production frontend URL. |
| Gmail OAuth state tampering | The `state` parameter in the OAuth flow is encrypted with our encryption key. Attacker can't forge a valid state. |
| Rate limiting | Not in this spec's scope but should be added later. Clerk's bot protection helps on the frontend. |
| SQL injection via user_id | `user_id` comes from a validated JWT claim — it's always a Clerk user ID string like `user_2abc123`. SQLAlchemy parameterizes queries. |

---

## 8. Testing Plan

| Test | Type | What It Validates |
|---|---|---|
| Valid Clerk JWT → user_id extracted | Backend unit | `get_current_user_id` returns the `sub` claim. |
| Invalid JWT → 401 | Backend unit | Endpoint rejects request with proper error. |
| Missing Authorization header → 401 | Backend unit | Endpoint rejects request. |
| User A can't see User B's data | Backend integration | Create transactions for two users, query as User A, only User A's data returned. |
| `/` redirects to `/dashboard` if authenticated | Frontend E2E | Signed-in user hits landing page, ends up on dashboard. |
| `/dashboard` redirects to `/sign-in` if unauthenticated | Frontend E2E | Signed-out user can't access dashboard. |
| `/dashboard` redirects to `/setup` if no bank connection | Frontend E2E | New user is routed to onboarding. |
| Teller Connect → token stored → transactions synced | Integration | Full flow from widget to DB rows. |
| Gmail OAuth → token stored → receipts scraped | Integration | Full flow from consent to receipt rows. |
| Scheduler syncs all users | Backend integration | Two users with connections, both synced. |
| `UserOAuthToken` encrypted at rest | Backend unit | Raw DB value is not readable JSON. Decrypted value is valid. |
