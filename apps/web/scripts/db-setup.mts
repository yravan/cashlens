import pg from "pg";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const PASSWORD = /^[A-Za-z0-9_]+$/;

function parseUrl(name: string): { url: URL; role: string; password: string; db: string } {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set — copy .env.example to .env.local first`);
  const url = new URL(raw);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, "");
  if (!IDENT.test(role) || !IDENT.test(db) || !PASSWORD.test(password)) {
    throw new Error(`${name} contains a role, database, or password with unsupported characters`);
  }
  return { url, role, password, db };
}

const app = parseUrl("DATABASE_URL");
const owner = parseUrl("DATABASE_URL_OWNER");
const superuser = parseUrl("DATABASE_URL_SUPERUSER");
if (app.db !== owner.db) throw new Error("DATABASE_URL and DATABASE_URL_OWNER must point at the same database");

async function withClient<T>(connectionString: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

await withClient(superuser.url.href, async (client) => {
  for (const { role, password } of [owner, app]) {
    const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    if (exists.rowCount === 0) {
      await client.query(`create role ${role} login password '${password}'`);
      console.log(`created role ${role}`);
    } else {
      await client.query(`alter role ${role} login password '${password}'`);
    }
  }
  const dbExists = await client.query("select 1 from pg_database where datname = $1", [app.db]);
  if (dbExists.rowCount === 0) {
    await client.query(`create database ${app.db} owner ${owner.role}`);
    console.log(`created database ${app.db}`);
  }
});

const superuserOnAppDb = new URL(superuser.url.href);
superuserOnAppDb.pathname = `/${app.db}`;
await withClient(superuserOnAppDb.href, async (client) => {
  await client.query(`alter schema public owner to ${owner.role}`);
  await client.query("revoke all on schema public from public");
  await client.query(`grant usage on schema public to ${app.role}`);
});

console.log(`database ${app.db} ready: owner=${owner.role} (migrations), app=${app.role} (runtime, RLS-enforced)`);
