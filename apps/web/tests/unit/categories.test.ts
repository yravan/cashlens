import { expect, test } from "vitest";

import { parseCategoryCreate, parseCategoryEdit } from "@/lib/ledger/categories";

const GROUP = "00000000-0000-4000-8000-000000000abc";
const invalid = { ok: false };

test("the create body is a closed plain object: a trimmed name and a null-or-string parent", () => {
  expect(parseCategoryCreate({ name: "  Pets  ", parentId: null })).toEqual({
    ok: true,
    input: { name: "Pets", parentId: null },
  });
  expect(parseCategoryCreate({ name: "Vet", parentId: GROUP })).toEqual({
    ok: true,
    input: { name: "Vet", parentId: GROUP },
  });
  for (const body of [
    {},
    { name: "Pets" },
    { parentId: null },
    { name: "Pets", parentId: null, retired: false },
    { name: "Pets", parentId: null, extra: 1 },
    { name: "Pets", parentId: 5 },
    { name: "Pets", parentId: undefined },
    { name: "Pets", parentId: [GROUP] },
    { name: "Pets", parentId: { id: GROUP } },
  ]) {
    expect(parseCategoryCreate(body)).toEqual(invalid);
  }
  for (const body of [null, undefined, [], "{}", "Pets", 7, Object.create(null)]) {
    expect(parseCategoryCreate(body)).toEqual(invalid);
  }
});

test("names are trimmed and bounded to 1–60 characters, the categories CHECK's rule", () => {
  for (const name of ["", "   ", "\t\n", "x".repeat(61), ` ${"x".repeat(61)} `, 7, null, undefined, ["x"]]) {
    expect(parseCategoryCreate({ name, parentId: null })).toEqual(invalid);
    expect(parseCategoryEdit({ name, parentId: null, retired: false })).toEqual(invalid);
  }
  expect(parseCategoryCreate({ name: ` ${"x".repeat(60)} `, parentId: null })).toEqual({
    ok: true,
    input: { name: "x".repeat(60), parentId: null },
  });
  expect(parseCategoryEdit({ name: " x ", parentId: GROUP, retired: true })).toEqual({
    ok: true,
    input: { name: "x", parentId: GROUP, retired: true },
  });
});

test("the edit body is the full state: exactly name, parentId, and a boolean retired", () => {
  expect(parseCategoryEdit({ name: "Coffee", parentId: GROUP, retired: false })).toEqual({
    ok: true,
    input: { name: "Coffee", parentId: GROUP, retired: false },
  });
  expect(parseCategoryEdit({ name: "Coffee", parentId: null, retired: true })).toEqual({
    ok: true,
    input: { name: "Coffee", parentId: null, retired: true },
  });
  for (const body of [
    { name: "Coffee", parentId: GROUP },
    { name: "Coffee", retired: false },
    { name: "Coffee", parentId: GROUP, retired: "false" },
    { name: "Coffee", parentId: GROUP, retired: 0 },
    { name: "Coffee", parentId: GROUP, retired: null },
    { name: "Coffee", parentId: GROUP, retired: undefined },
    { name: "Coffee", parentId: 5, retired: false },
    { name: "Coffee", parentId: GROUP, retired: false, sortOrder: 0 },
  ]) {
    expect(parseCategoryEdit(body)).toEqual(invalid);
  }
  for (const body of [null, [], "{}", Object.create(null)]) {
    expect(parseCategoryEdit(body)).toEqual(invalid);
  }
});
