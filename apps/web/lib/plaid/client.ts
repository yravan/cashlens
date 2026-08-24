import "server-only";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

export class PlaidRequestError extends Error {
  constructor(
    readonly errorType: string,
    readonly errorCode: string,
    readonly displayMessage: string | null,
    readonly requestId?: string,
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
  const errorType = text("error_type");
  const errorCode = text("error_code");
  if (errorType && errorCode) {
    throw new PlaidRequestError(errorType, errorCode, text("display_message"), text("request_id") ?? undefined);
  }
  throw new PlaidRequestError("API_ERROR", "UNREACHABLE", null);
}

export type PlaidBalances = {
  available: number | null;
  current: number | null;
  limit: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
};

export type PlaidAccount = {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: PlaidBalances;
};

export type PlaidItemAccounts = {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  accounts: PlaidAccount[];
};

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

export async function getItemAccounts(accessToken: string): Promise<PlaidItemAccounts> {
  try {
    const { data } = await client().accountsGet({ access_token: accessToken });
    return {
      itemId: data.item.item_id,
      institutionId: data.item.institution_id ?? null,
      institutionName: data.item.institution_name ?? null,
      accounts: data.accounts.map((account) => ({
        accountId: account.account_id,
        name: account.name,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        balances: {
          available: account.balances.available,
          current: account.balances.current,
          limit: account.balances.limit,
          isoCurrencyCode: account.balances.iso_currency_code,
          unofficialCurrencyCode: account.balances.unofficial_currency_code,
        },
      })),
    };
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
