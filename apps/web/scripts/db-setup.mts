import pg from "pg";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const PASSWORD = /^[A-Za-z0-9_]+$/;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — copy .env.example to .env.local first`);
  return value;
}

function credentials(name: string): { role: string; password: string; db: string } {
  const url = new URL(env(name));
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, "");
  if (!IDENT.test(role) || !IDENT.test(db) || !PASSWORD.test(password)) {
    throw new Error(`${name} contains a role, database, or password with unsupported characters`);
  }
  return { role, password, db };
}

const app = credentials("DATABASE_URL");
const owner = credentials("DATABASE_URL_OWNER");
if (app.db !== owner.db) throw new Error("DATABASE_URL and DATABASE_URL_OWNER must point at the same database");

async function run(connectionString: string, fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

await run(env("DATABASE_URL_SUPERUSER"), async (client) => {
  for (const { role, password } of [owner, app]) {
    const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    await client.query(`${exists.rowCount ? "alter" : "create"} role ${role} login password '${password}'`);
  }
  await client.query(`alter role ${app.role} set statement_timeout = '15s'`);
  await client.query(`alter role ${app.role} set idle_in_transaction_session_timeout = '30s'`);
  const dbExists = await client.query("select 1 from pg_database where datname = $1", [app.db]);
  if (!dbExists.rowCount) await client.query(`create database ${app.db} owner ${owner.role}`);
});

const superuserOnAppDb = new URL(env("DATABASE_URL_SUPERUSER"));
superuserOnAppDb.pathname = `/${app.db}`;
await run(superuserOnAppDb.href, async (client) => {
  await client.query(`alter schema public owner to ${owner.role}`);
  await client.query("revoke all on schema public from public");
  await client.query(`grant usage on schema public to ${app.role}`);
});

console.log(`database ${app.db} ready: owner=${owner.role} (migrations), app=${app.role} (runtime, RLS-enforced)`);
