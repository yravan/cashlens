import { isPlainObject } from "./manual-transactions";
import { hasExactKeys, type ParsedOfflineInput } from "./offline-accounts";

export type CategoryCreateInput = { name: string; parentId: string | null };
export type CategoryEditInput = CategoryCreateInput & { retired: boolean };

const CREATE_KEYS = ["name", "parentId"] as const;
const EDIT_KEYS = ["name", "parentId", "retired"] as const;

function parseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length === 0 || name.length > 60 ? null : name;
}

const isParentId = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

export function parseCategoryCreate(body: unknown): ParsedOfflineInput<CategoryCreateInput> {
  if (!isPlainObject(body) || !hasExactKeys(body, CREATE_KEYS)) return { ok: false };
  const name = parseName(body.name);
  if (name === null || !isParentId(body.parentId)) return { ok: false };
  return { ok: true, input: { name, parentId: body.parentId } };
}

export function parseCategoryEdit(body: unknown): ParsedOfflineInput<CategoryEditInput> {
  if (!isPlainObject(body) || !hasExactKeys(body, EDIT_KEYS)) return { ok: false };
  const name = parseName(body.name);
  if (name === null || !isParentId(body.parentId) || typeof body.retired !== "boolean") {
    return { ok: false };
  }
  return { ok: true, input: { name, parentId: body.parentId, retired: body.retired } };
}
