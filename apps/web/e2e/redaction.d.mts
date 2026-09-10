export const MARKER: string;
export function collectSecrets(stateDir: string, env?: NodeJS.ProcessEnv): string[];
export function redact(text: string, secrets: string[]): string;
