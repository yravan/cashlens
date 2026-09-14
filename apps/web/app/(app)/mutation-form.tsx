import { useRef, useState, useTransition, type ReactNode } from "react";

export const inputClass =
  "mt-1 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";
export const formClass =
  "min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950";
export const primaryButton =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
export const quietButton =
  "rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700";

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

const post = (endpoint: string, body: unknown) =>
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function useMutation(
  responseError: (response: Response, fallback: string) => Promise<string>,
  onDone: () => void,
) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const run = (endpoint: string, body: unknown, failure: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await post(endpoint, body);
        if (!response.ok) {
          setError(await responseError(response, failure));
          return;
        }
        onDone();
      } catch {
        setError(failure);
      } finally {
        submittingRef.current = false;
      }
    });
  };
  return { error, setError, pending, run };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
      {error}
    </p>
  );
}

export function RowForm({
  label,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  children,
}: {
  label: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className={`mt-3 ${formClass}`}
    >
      <div className="grid min-w-0 gap-4 sm:max-w-sm">{children}</div>
      <ErrorLine error={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={quietButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
