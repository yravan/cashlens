export const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";

export function localDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function responseErrorFor<Code extends string>(copy: Record<Code, string>) {
  const known = (code: string): code is Code => Object.hasOwn(copy, code);
  return async (response: Response, fallback: string) => {
    try {
      const value: unknown = await response.json();
      if (typeof value !== "object" || value === null || !("error" in value)) return fallback;
      const code = value.error;
      return typeof code === "string" && known(code) ? copy[code] : fallback;
    } catch {
      return fallback;
    }
  };
}
