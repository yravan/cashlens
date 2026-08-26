import "server-only";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  TransactionsUpdateStatus,
  type AccountBase,
  type RemovedTransaction,
  type Transaction,
} from "plaid";

export type { AccountBase, RemovedTransaction, Transaction };

export type UpdateStatus = "complete" | "pending" | "unknown";

export class PlaidRequestError extends Error {
  constructor(
    readonly errorType: string,
    readonly errorCode: string,
    readonly displayMessage: string | null,
  ) {
    super(`plaid request failed: ${errorType}/${errorCode}`);
  }
}

const globalForPlaid = globalThis as unknown as { cashlensPlaid?: PlaidApi };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

function client(): PlaidApi {
  if (!globalForPlaid.cashlensPlaid) {
    const env = requireEnv("PLAID_ENV");
    if (env !== "sandbox" && env !== "production") {
      throw new Error("PLAID_ENV must be sandbox or production");
    }
    globalForPlaid.cashlensPlaid = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[env],
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": requireEnv("PLAID_CLIENT_ID"),
            "PLAID-SECRET": requireEnv("PLAID_SECRET"),
            "Plaid-Version": "2020-09-14",
          },
          timeout: 30_000,
        },
      }),
    );
  }
  return globalForPlaid.cashlensPlaid;
}

// Raw client errors embed the API secret in error.config.headers, so they must
// never propagate to a caller, a logger, or a test reporter.
function domainError(error: unknown): never {
  const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data;
  const text = (field: string) => {
    const value = data?.[field];
    return typeof value === "string" ? value : null;
  };
  throw new PlaidRequestError(
    text("error_type") ?? "API_ERROR",
    text("error_code") ?? "UNREACHABLE",
    text("display_message"),
  );
}

export async function createLinkToken(clientUserId: string): Promise<string> {
  try {
    const { data } = await client().linkTokenCreate({
      client_name: "Cash Lens",
      language: "en",
      country_codes: [CountryCode.Us],
      products: [Products.Transactions],
      transactions: { days_requested: 730 },
      user: { client_user_id: clientUserId },
    });
    return data.link_token;
  } catch (error) {
    domainError(error);
  }
}

export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  try {
    const { data } = await client().itemPublicTokenExchange({ public_token: publicToken });
    return { accessToken: data.access_token, itemId: data.item_id };
  } catch (error) {
    domainError(error);
  }
}

export async function getItemAccounts(accessToken: string) {
  try {
    const { data } = await client().accountsGet({ access_token: accessToken });
    return {
      institutionId: data.item.institution_id ?? undefined,
      institutionName: data.item.institution_name ?? undefined,
      accounts: data.accounts,
    };
  } catch (error) {
    domainError(error);
  }
}

function toUpdateStatus(status: TransactionsUpdateStatus): UpdateStatus {
  if (status === TransactionsUpdateStatus.HistoricalUpdateComplete) return "complete";
  if (status === TransactionsUpdateStatus.TransactionsUpdateStatusUnknown) return "unknown";
  return "pending";
}

export async function syncTransactions(accessToken: string, cursor: string | null, count: number) {
  try {
    const { data } = await client().transactionsSync({
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      count,
    });
    return {
      added: data.added,
      modified: data.modified,
      removed: data.removed,
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
      updateStatus: toUpdateStatus(data.transactions_update_status),
    };
  } catch (error) {
    domainError(error);
  }
}

// The one balance endpoint that pulls live from the institution rather than
// Plaid's cache. min_last_updated_datetime is ignored everywhere except
// Capital One non-depository accounts, which reject the request without it.
export async function getFreshBalances(accessToken: string): Promise<AccountBase[]> {
  const staleFloor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data } = await client().accountsBalanceGet({
      access_token: accessToken,
      options: { min_last_updated_datetime: staleFloor },
    });
    return data.accounts;
  } catch (error) {
    domainError(error);
  }
}

export async function removeItem(accessToken: string): Promise<void> {
  try {
    await client().itemRemove({ access_token: accessToken });
  } catch (error) {
    domainError(error);
  }
}
