const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalDatabaseUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set — seeding needs the local database (see CLAUDE.md)`);
  }
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error(`${name} is not a parsable URL — refusing to seed`);
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `${name} points at "${hostname}" — pnpm db:seed only ever seeds a local database`,
    );
  }
  return value;
}
