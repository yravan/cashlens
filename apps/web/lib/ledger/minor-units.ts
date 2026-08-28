const EXPONENT_0 = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const EXPONENT_3 = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

const exponent = (currency: string) =>
  EXPONENT_0.has(currency) ? 0 : EXPONENT_3.has(currency) ? 3 : 2;

// The epsilon absorbs float noise below the half boundary (0.615 * 100 ===
// 61.49999999999999); rounding is half away from zero.
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error("amount must be a finite number");
  }
  const scaled = Math.abs(amount) * 10 ** exponent(currency);
  const minor = Math.round(scaled + 1e-7) * Math.sign(amount);
  if (!Number.isSafeInteger(minor)) {
    throw new Error("amount exceeds safe integer range in minor units");
  }
  return minor === 0 ? 0 : minor;
}

// Intl divides by the exponent itself, so the integer goes in as a decimal
// string — no float division, exact at every magnitude a bigint column holds.
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let found = formatters.get(currency);
  if (!found) {
    const digits = exponent(currency);
    found = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(currency, found);
  }
  return found;
}

export function formatMinorUnits(minorUnits: number, currency: string): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error("minor units must be a safe integer");
  }
  const digits = exponent(currency);
  const sign = minorUnits < 0 ? "-" : "";
  const units = Math.abs(minorUnits).toString().padStart(digits + 1, "0");
  const whole = units.slice(0, units.length - digits);
  const fraction = units.slice(units.length - digits);
  return formatter(currency).format(`${sign}${whole}${fraction && `.${fraction}`}`);
}
