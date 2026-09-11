import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { UUID_PATTERN } from "@/lib/crypto/credentials";
import {
  claimPlaidCleanupAs,
  completeConnectionCleanupAs,
  createConnectionAs,
  disconnectConnection,
  markConnectionCleanupAs,
  readConnectionCredentialAs,
  revokeConnectionAs,
  setProviderErrorAs,
} from "@/lib/data/connections";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, accountType, connections } from "@/lib/db/schema";
import { toMinorUnits } from "@/lib/ledger/minor-units";
import { errorClass, logEvent } from "@/lib/log";
import {
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  getItemAccounts,
  PlaidRequestError,
  removeItem,
  type AccountBase,
} from "@/lib/plaid/client";

export class InvalidPublicTokenError extends Error {}
export class DuplicateConnectionError extends Error {}
export class RateLimitedError extends Error {}
export class ReauthRequiredError extends Error {}
export class ConnectionGoneError extends Error {}
export class ProviderError extends Error {
  constructor(readonly displayMessage: string | null) {
    super("provider request failed");
  }
}

// The item states Link update mode can repair (ITEM_LOCKED and friends need the
// user at the bank first). Login-class = broken now, so a working sync disproves
// it; warning-class = consent lapsing while sync still works, so it stands.
export const LOGIN_REPAIR_CODES = new Set(["ITEM_LOGIN_REQUIRED", "ACCESS_NOT_GRANTED"]);
export const WARNING_REPAIR_CODES = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

export function translated(error: unknown): never {
  if (error instanceof PlaidRequestError) {
    if (error.errorCode === "INVALID_PUBLIC_TOKEN") throw new InvalidPublicTokenError();
    if (error.errorType === "RATE_LIMIT_EXCEEDED") throw new RateLimitedError();
    throw new ProviderError(error.displayMessage);
  }
  throw error;
}

export const PUBLIC_TOKEN_PATTERN = /^public-[A-Za-z0-9-]{1,250}$/;

export async function createLinkTokenForUser(): Promise<string> {
  const user = await requireUser();
  return createLinkToken(user.id).catch(translated);
}

// Compatibility for clients that still notify the server after declining the
// duplicate warning. Plaid says detected duplicates must not be exchanged.
export async function abandonPlaidItem(publicToken: string): Promise<void> {
  void publicToken;
  await requireUser();
}

// Mint-on-click: update-mode link tokens expire after 30 minutes. A mint
// failing with ITEM_NOT_FOUND means the item is already dead at Plaid
// (removed via portal or support) — revoke the connection on the spot.
export async function createRepairToken(connectionId: string): Promise<string | null> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(connectionId)) return null;
  const credential = await readConnectionCredentialAs(user, connectionId);
  if (!credential) return null;
  try {
    return await createUpdateLinkToken(user.id, credential.expose());
  } catch (error) {
    if (error instanceof PlaidRequestError && error.errorCode === "ITEM_NOT_FOUND") {
      await revokeConnectionAs(user, connectionId);
      throw new ConnectionGoneError();
    }
    translated(error);
  }
}

// The user completed Link update mode. Plaid never webhooks in-app repairs
// (LOGIN_REPAIRED is out-of-band only), so the completion signal clears the
// mark; the caller then drives a sync, which re-marks if the repair lied.
export async function markConnectionRepaired(connectionId: string): Promise<boolean> {
  const user = await requireUser();
  if (!UUID_PATTERN.test(connectionId)) return false;
  return setProviderErrorAs(user, connectionId, null);
}

// Remote-first, fail-closed: /item/remove must succeed (or the item must
// already be gone — ITEM_NOT_FOUND) before anything is deleted locally. A
// credential deleted after a failed remove would leave the item billing
// forever with no recovery path.
export async function disconnectPlaidConnection(connectionId: string, purge: boolean) {
  const user = await requireUser();
  if (!UUID_PATTERN.test(connectionId)) return null;
  const credential = await readConnectionCredentialAs(user, connectionId);
  if (credential) {
    try {
      await removeItem(credential.expose());
    } catch (error) {
      if (!(error instanceof PlaidRequestError && error.errorCode === "ITEM_NOT_FOUND")) {
        translated(error);
      }
    }
  }
  return disconnectConnection(connectionId, { purge });
}

type AccountType = (typeof accountType.enumValues)[number];

function normalizeType(type: string): AccountType {
  const known: readonly string[] = accountType.enumValues;
  return known.includes(type) ? (type as AccountType) : "other";
}

export const currencyOf = (
  {
    iso_currency_code,
    unofficial_currency_code,
  }: Pick<AccountBase["balances"], "iso_currency_code" | "unofficial_currency_code">,
  fallback = "USD",
) =>
  [iso_currency_code, unofficial_currency_code].find((code) => code && /^[A-Z]{3}$/.test(code)) ??
  fallback;

const minorOrNull = (value: number | null, currency: string) =>
  value === null ? null : toMinorUnits(value, currency);

function boundedProviderText(value: string | undefined, name: string): string | undefined {
  if (value !== undefined && (value.length === 0 || value.length > 512)) {
    throw new Error(`${name} must be 1 to 512 characters`);
  }
  return value;
}

export function balanceRow(
  accountId: string,
  userId: string,
  balances: AccountBase["balances"],
  asOf: Date,
  fallbackCurrency = "USD",
) {
  const { available, current, limit } = balances;
  if (available === null && current === null) return [];
  const currency = currencyOf(balances, fallbackCurrency);
  return [
    {
      accountId,
      userId,
      availableMinor: minorOrNull(available, currency),
      currentMinor: minorOrNull(current, currency),
      limitMinor: minorOrNull(limit, currency),
      asOf,
    },
  ];
}

function isDuplicateItem(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === "23505" && cause?.constraint === "connections_user_provider_item_key";
}

const itemIsGone = (error: unknown) =>
  error instanceof PlaidRequestError && error.errorCode === "ITEM_NOT_FOUND";

async function completeFailedConnect(
  user: { id: string; clerkUserId: string },
  connectionId: string,
  accessToken: string,
): Promise<void> {
  await markConnectionCleanupAs(user, connectionId).catch((error: unknown) =>
    logEvent("plaid_connect.cleanup_mark_failed", {
      connectionId,
      error: errorClass(error),
    }),
  );
  try {
    await removeItem(accessToken);
  } catch (error) {
    if (!itemIsGone(error)) {
      logEvent("plaid_connect.cleanup_remove_failed", {
        connectionId,
        error: errorClass(error),
      });
      return;
    }
  }
  await completeConnectionCleanupAs(user, connectionId).catch((error: unknown) =>
    logEvent("plaid_connect.cleanup_complete_failed", {
      connectionId,
      error: errorClass(error),
    }),
  );
}

async function compensateFailedPersistence(accessToken: string, itemId: string): Promise<void> {
  try {
    await removeItem(accessToken);
  } catch (error) {
    if (!itemIsGone(error)) {
      logEvent("plaid_connect.persistence_compensation_failed", {
        itemId,
        error: errorClass(error),
      });
    }
  }
}

export async function connectPlaidItem(publicToken: string) {
  const user = await requireUser();
  const { accessToken, itemId } = await exchangePublicToken(publicToken).catch(translated);

  let connection;
  try {
    connection = await createConnectionAs(user, {
      provider: "plaid",
      credential: accessToken,
      providerItemId: itemId,
      webhookUrl: process.env.PLAID_WEBHOOK_URL,
    }, "provisioning");
  } catch (error) {
    if (isDuplicateItem(error)) throw new DuplicateConnectionError();
    await compensateFailedPersistence(accessToken, itemId);
    throw error;
  }

  try {
    const item = await getItemAccounts(accessToken).catch(translated);
    const institutionId = boundedProviderText(item.institutionId, "institutionId");
    const institutionName = boundedProviderText(item.institutionName, "institutionName");
    return await withRequestScope(user.clerkUserId, async (tx) => {
      const inserted =
        item.accounts.length === 0
          ? []
          : await tx
              .insert(accounts)
              .values(
                item.accounts.map((account) => ({
                  userId: user.id,
                  connectionId: connection.id,
                  name: account.name,
                  type: normalizeType(account.type),
                  subtype: account.subtype,
                  mask: account.mask,
                  currency: currencyOf(account.balances),
                  source: "plaid" as const,
                  sourceId: account.account_id,
                })),
              )
              .returning({
                id: accounts.id,
                name: accounts.name,
                type: accounts.type,
                subtype: accounts.subtype,
                mask: accounts.mask,
                currency: accounts.currency,
              });

      const asOf = new Date();
      const balanceRows = item.accounts.flatMap((account, index) =>
        balanceRow(inserted[index].id, user.id, account.balances, asOf),
      );
      if (balanceRows.length > 0) await tx.insert(accountBalances).values(balanceRows);

      const [activated] = await tx
        .update(connections)
        .set({
          institutionId,
          institutionName,
          status: "active",
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(connections.id, connection.id),
            eq(connections.userId, user.id),
            eq(connections.status, "provisioning"),
          ),
        )
        .returning({
          id: connections.id,
          provider: connections.provider,
          institutionId: connections.institutionId,
          institutionName: connections.institutionName,
          status: connections.status,
          backfillStatus: connections.backfillStatus,
          providerError: connections.providerError,
          createdAt: connections.createdAt,
        });
      if (!activated) throw new Error("Plaid connection is no longer provisioning");
      return { connection: activated, accounts: inserted };
    });
  } catch (error) {
    await completeFailedConnect(user, connection.id, accessToken);
    throw error;
  }
}

export async function retryPlaidCleanup(connectionId: string): Promise<boolean | null> {
  const user = await requireUser();
  const credential = await claimPlaidCleanupAs(user, connectionId);
  if (!credential) return null;
  try {
    await removeItem(credential.expose());
  } catch (error) {
    if (!itemIsGone(error)) translated(error);
  }
  if (!(await completeConnectionCleanupAs(user, connectionId))) {
    throw new Error("Claimed Plaid cleanup could not be completed");
  }
  return true;
}
