const EXPONENT_0 = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const EXPONENT_3 = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

function exponent(currency: string): number {
  if (EXPONENT_0.has(currency)) return 0;
  if (EXPONENT_3.has(currency)) return 3;
  return 2;
}

// Provider amounts are decimals serialized as floats (110.94, 210.33). The
// epsilon absorbs float noise below the half boundary (0.615 * 100 ===
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
