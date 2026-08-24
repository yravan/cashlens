import { randomUUID } from "node:crypto";

// vitest.config.mts aliases the `plaid` package to this file for the api suite.

type SandboxBalances = {
  available: number | null;
  current: number | null;
  limit: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
};

export type SandboxAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: SandboxBalances;
};

type SandboxItem = {
  access_token: string;
  item_id: string;
  institution_id: string;
  institution_name: string;
  accounts: SandboxAccount[];
};

const byPublicToken = new Map<string, SandboxItem>();
const byAccessToken = new Map<string, SandboxItem>();
export const linkTokenRequests: Array<Record<string, unknown>> = [];
export const exchangeRequests: string[] = [];
export const removedAccessTokens: string[] = [];

export function resetPlaidSubstitute(): void {
  byPublicToken.clear();
  byAccessToken.clear();
  linkTokenRequests.length = 0;
  exchangeRequests.length = 0;
  removedAccessTokens.length = 0;
}

export const SANDBOX_INSTITUTION = {
  institution_id: "ins_109508",
  institution_name: "First Platypus Bank",
};

const usd = (
  available: number | null,
  current: number | null,
  limit: number | null = null,
): SandboxBalances => ({
  available,
  current,
  limit,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
});

export function sandboxAccounts(): SandboxAccount[] {
  return [
    {
      account_id: `sub-checking-${randomUUID()}`,
      name: "Plaid Checking",
      official_name: "Plaid Gold Standard 0% Interest Checking",
      mask: "0000",
      type: "depository",
      subtype: "checking",
      balances: usd(100, 110),
    },
    {
      account_id: `sub-saving-${randomUUID()}`,
      name: "Plaid Saving",
      official_name: "Plaid Silver Standard 0.1% Interest Saving",
      mask: "1111",
      type: "depository",
      subtype: "savings",
      balances: usd(200, 210.33),
    },
    {
      account_id: `sub-credit-${randomUUID()}`,
      name: "Plaid Credit Card",
      official_name: "Plaid Diamond 12.5% APR Interest Credit Card",
      mask: "3333",
      type: "credit",
      subtype: "credit card",
      balances: usd(null, 410, 2000),
    },
  ];
}

type MintOptions = Partial<Omit<SandboxItem, "accounts">> & { accounts?: SandboxAccount[] };

export function mintSandboxItem(options: MintOptions = {}) {
  const item: SandboxItem = {
    access_token: options.access_token ?? `access-sandbox-${randomUUID()}`,
    item_id: options.item_id ?? `item-sandbox-${randomUUID()}`,
    institution_id: options.institution_id ?? SANDBOX_INSTITUTION.institution_id,
    institution_name: options.institution_name ?? SANDBOX_INSTITUTION.institution_name,
    accounts: options.accounts ?? sandboxAccounts(),
  };
  const publicToken = `public-sandbox-${randomUUID()}`;
  byPublicToken.set(publicToken, item);
  byAccessToken.set(item.access_token, item);
  return { publicToken, accessToken: item.access_token, itemId: item.item_id, item };
}

export function revokeAccessToken(accessToken: string): void {
  byAccessToken.delete(accessToken);
}

function refuse(surface: string): never {
  throw new Error(
    `${surface} is not implemented by the api-suite Plaid substitute (tests/harness/plaid.ts) — extend it when production code grows a real use`,
  );
}

// The real client rejects with axios errors whose config.headers carry the API
// secret (called out in plaid-node's README); reproducing that makes leak
// assertions meaningful.
function plaidReject(status: number, errorType: string, errorCode: string, message: string) {
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config: { headers: { "PLAID-SECRET": "leaked-substitute-secret-never-print" } },
    response: {
      status,
      data: {
        error_type: errorType,
        error_code: errorCode,
        error_message: message,
        display_message: null,
        request_id: randomUUID().slice(0, 12),
      },
    },
  });
  return Promise.reject(error);
}

const respond = <T extends Record<string, unknown>>(data: T) => ({
  data: { ...data, request_id: randomUUID().slice(0, 12) },
});

export class Configuration {
  constructor(readonly options: Record<string, unknown>) {}
}

export const PlaidEnvironments: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export const Products = { Transactions: "transactions" } as const;
export const CountryCode = { Us: "US" } as const;

export class PlaidApi {
  constructor(_configuration: Configuration) {
    return new Proxy(this, {
      get(target, property, receiver) {
        if (typeof property === "symbol" || Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }
        refuse(`PlaidApi.${property}()`);
      },
    });
  }

  async linkTokenCreate(request: Record<string, unknown>) {
    linkTokenRequests.push(request);
    const user = request.user as { client_user_id?: unknown } | undefined;
    if (!user?.client_user_id || !Array.isArray(request.products)) {
      return plaidReject(400, "INVALID_REQUEST", "MISSING_FIELDS", "missing required fields");
    }
    return respond({
      link_token: `link-sandbox-${randomUUID()}`,
      expiration: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });
  }

  async itemPublicTokenExchange({ public_token }: { public_token: string }) {
    exchangeRequests.push(public_token);
    const item = byPublicToken.get(public_token);
    if (!item) {
      return plaidReject(
        400,
        "INVALID_INPUT",
        "INVALID_PUBLIC_TOKEN",
        "could not find matching public token",
      );
    }
    byPublicToken.delete(public_token);
    return respond({ access_token: item.access_token, item_id: item.item_id });
  }

  async accountsGet({ access_token }: { access_token: string }) {
    const item = byAccessToken.get(access_token);
    if (!item) {
      return plaidReject(
        400,
        "INVALID_INPUT",
        "INVALID_ACCESS_TOKEN",
        "could not find matching access token",
      );
    }
    return respond({
      accounts: structuredClone(item.accounts),
      item: {
        item_id: item.item_id,
        institution_id: item.institution_id,
        institution_name: item.institution_name,
        webhook: null,
        error: null,
        available_products: [],
        billed_products: ["transactions"],
        consent_expiration_time: null,
        update_type: "background",
      },
    });
  }

  async itemRemove({ access_token }: { access_token: string }) {
    if (!byAccessToken.delete(access_token)) {
      return plaidReject(
        400,
        "INVALID_INPUT",
        "INVALID_ACCESS_TOKEN",
        "could not find matching access token",
      );
    }
    removedAccessTokens.push(access_token);
    return respond({});
  }
}
