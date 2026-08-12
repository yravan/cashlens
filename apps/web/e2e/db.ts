import { Client } from "pg";

function envUrl(name: "DATABASE_URL" | "DATABASE_URL_SUPERUSER"): string {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set — the e2e suite needs the local database (see CLAUDE.md)`);
  return raw;
}

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function adminQuery(text: string, params: unknown[] = []) {
  const admin = new URL(envUrl("DATABASE_URL_SUPERUSER"));
  admin.pathname = new URL(envUrl("DATABASE_URL")).pathname;
  return withClient(admin.href, (client) => client.query(text, params));
}

export function appQuery(text: string, params: unknown[] = []) {
  return withClient(envUrl("DATABASE_URL"), (client) => client.query(text, params));
}

export function appQueryScopedAs(clerkUserId: string, text: string, params: unknown[] = []) {
  return withClient(envUrl("DATABASE_URL"), async (client) => {
    await client.query("begin");
    try {
      await client.query("select set_config('app.clerk_user_id', $1, true)", [clerkUserId]);
      return await client.query(text, params);
    } finally {
      await client.query("rollback");
    }
  });
}
