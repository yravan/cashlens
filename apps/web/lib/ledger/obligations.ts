import { isIsoDate } from "./history-query";
import { hasExactKeys, parseName, type ParsedOfflineInput } from "./offline-accounts";
import { isEmptyMutationBody, isPlainObject } from "./manual-transactions";
import { parseMajorUnits } from "./minor-units";

const CADENCES = new Set(["once", "weekly", "biweekly", "monthly", "annual"] as const);
export type ObligationCadence = "once" | "weekly" | "biweekly" | "monthly" | "annual";

const isCadence = (value: unknown): value is ObligationCadence =>
  typeof value === "string" && CADENCES.has(value as ObligationCadence);

export type ObligationInput = {
  accountId: string;
  name: string;
  amountMinor: number;
  currency: string;
  cadence: ObligationCadence;
  startsOn: string;
  endsOn: string | null;
};

export type ParsedObligationInput = ParsedOfflineInput<ObligationInput>;

const OBLIGATION_KEYS = [
  "accountId",
  "name",
  "amount",
  "currency",
  "cadence",
  "startsOn",
  "endsOn",
] as const;
const CURRENCY = /^[A-Z]{3}$/;

export const parseObligationEndInput = isEmptyMutationBody;

export function parseObligationInput(body: unknown): ParsedObligationInput {
  if (!isPlainObject(body) || !hasExactKeys(body, OBLIGATION_KEYS)) return { ok: false };
  const { accountId, amount, currency, cadence, startsOn, endsOn } = body;
  const name = parseName(body.name);
  if (
    typeof accountId !== "string" ||
    name === null ||
    typeof amount !== "string" ||
    amount.length > 32 ||
    typeof currency !== "string" ||
    !CURRENCY.test(currency) ||
    !isCadence(cadence) ||
    typeof startsOn !== "string" ||
    !isIsoDate(startsOn) ||
    (endsOn !== null &&
      (typeof endsOn !== "string" || !isIsoDate(endsOn) || endsOn < startsOn)) ||
    (cadence === "once" && endsOn !== null)
  ) {
    return { ok: false };
  }
  const amountMinor = parseMajorUnits(amount, currency);
  if (amountMinor === null || amountMinor === 0) return { ok: false };
  return {
    ok: true,
    input: {
      accountId,
      name,
      amountMinor,
      currency,
      cadence,
      startsOn,
      endsOn,
    },
  };
}
