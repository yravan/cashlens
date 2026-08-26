type Field = string | number | boolean | null;

// Identifiers, counts and error classes only — never provider payloads,
// tokens, or amounts tied to an identifiable row.
export function logEvent(event: string, fields: Record<string, Field>): void {
  console.info(JSON.stringify({ event, ...fields }));
}

export const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : "unknown";
