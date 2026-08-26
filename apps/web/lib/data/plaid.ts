import "server-only";

import { createConnection } from "@/lib/data/connections";
import { requireUser } from "@/lib/data/users";
import { withRequestScope } from "@/lib/db/client";
import { accountBalances, accounts, accountType } from "@/lib/db/schema";
import { toMinorUnits } from "@/lib/ledger/minor-units";
import {
  createLinkToken,
  exchangePublicToken,
  getItemAccounts,
  PlaidRequestError,
  removeItem,
  type AccountBase,
} from "@/lib/plaid/client";

export class InvalidPublicTokenError extends Error {}
export class DuplicateConnectionError extends Error {}
export class RateLimitedError extends Error {}
export class ProviderError extends Error {
  constructor(readonly displayMessage: string | null) {
    super("provider request failed");
  }
}

export function translated(error: unknown): never {
  if (error instanceof PlaidRequestError) {
    if (error.errorCode === "INVALID_PUBLIC_TOKEN") throw new InvalidPublicTokenError();
    if (error.errorType === "RATE_LIMIT_EXCEEDED") throw new RateLimitedError();
    throw new ProviderError(error.displayMessage);
  }
  throw error;
}

export async function createLinkTokenForUser(): Promise<string> {
  const user = await requireUser();
  return createLinkToken(user.id).catch(translated);
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

export async function connectPlaidItem(publicToken: string) {
  const user = await requireUser();
  const { accessToken, itemId } = await exchangePublicToken(publicToken).catch(translated);
  const item = await getItemAccounts(accessToken).catch(translated);

  let connection;
  try {
    connection = await createConnection({
      provider: "plaid",
      credential: accessToken,
      providerItemId: itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName,
    });
  } catch (error) {
    if (!isDuplicateItem(error)) throw error;
    await removeItem(accessToken).catch(() => {});
    throw new DuplicateConnectionError();
  }

  const registered = await withRequestScope(user.clerkUserId, async (tx) => {
    if (item.accounts.length === 0) return [];
    const inserted = await tx
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
    return inserted;
  });

  return { connection, accounts: registered };
}
