type Field = string | number | boolean | null;

// Structured operational events, one JSON line each. Callers pass identifiers
// and counts only — never provider payloads, tokens, or amounts tied to an
// identifiable row.
export function logEvent(event: string, fields: Record<string, Field>): void {
  console.info(JSON.stringify({ event, ...fields }));
}
