"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { CategoryMutationError } from "@/lib/data/categories";
import { inputClass, quietButton, responseErrorFor, RowForm, useMutation } from "../mutation-form";

export type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  retired: boolean;
  movable: boolean;
};
export type GroupOption = { id: string; name: string };
type Action = "rename" | "move";

const ERROR_COPY: Record<CategoryMutationError | "invalid_request", string> = {
  invalid_request: "Enter a name of 1 to 60 characters.",
  category_not_found: "That category is no longer available.",
  parent_not_found: "That group is no longer available.",
  has_children: "Move its categories out first.",
  name_taken: "That name is already used here — it may belong to a retired category.",
};
const responseError = responseErrorFor(ERROR_COPY);
const actionClass = "underline underline-offset-4";

function NameField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="min-w-0 text-sm font-medium">
      Name
      <input
        required
        maxLength={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={inputClass}
      />
    </label>
  );
}

export function AddCategory({
  parentId,
  groupName,
}: {
  parentId: string | null;
  groupName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { error, setError, pending, run } = useMutation(responseError, () => {
    setOpen(false);
    setName("");
    router.refresh();
  });
  const label = parentId === null ? "Add group" : "Add category";

  if (!open) {
    return (
      <button
        type="button"
        aria-label={groupName === undefined ? undefined : `Add category to ${groupName}`}
        onClick={() => {
          setName("");
          setError(null);
          setOpen(true);
        }}
        className={parentId === null ? `mt-6 ${quietButton}` : `mt-3 text-sm ${actionClass}`}
      >
        {label}
      </button>
    );
  }

  return (
    <RowForm
      label={label}
      submitLabel={label}
      pending={pending}
      error={error}
      onCancel={() => setOpen(false)}
      onSubmit={() =>
        run(
          "/api/categories",
          { name, parentId },
          `Couldn’t add the ${parentId === null ? "group" : "category"}. Try again.`,
        )
      }
    >
      <NameField value={name} onChange={setName} disabled={pending} />
    </RowForm>
  );
}

export function CategoryActions({ row, groups }: { row: CategoryRow; groups: GroupOption[] }) {
  const router = useRouter();
  const actions = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Action | null>(null);
  const [mode, setMode] = useState<"idle" | Action>("idle");
  const [name, setName] = useState(row.name);
  const [parentId, setParentId] = useState(row.parentId ?? "");
  const selectedParentId =
    parentId === "" || groups.some((group) => group.id === parentId && group.id !== row.id)
      ? parentId
      : "";
  const { error, setError, pending, run } = useMutation(responseError, () => {
    setMode("idle");
    router.refresh();
  });

  useEffect(() => {
    if (mode !== "idle" || returnTo.current === null) return;
    actions.current
      ?.querySelector<HTMLButtonElement>(`[data-action="${returnTo.current}"]`)
      ?.focus();
    returnTo.current = null;
  }, [mode]);

  const open = (next: Action) => {
    setName(row.name);
    setParentId(row.parentId ?? "");
    setError(null);
    returnTo.current = next;
    setMode(next);
  };
  const close = () => setMode("idle");
  const save = (body: { name: string; parentId: string | null }, failure: string) =>
    run(`/api/categories/${row.id}`, { ...body, retired: row.retired }, failure);

  if (mode === "rename") {
    return (
      <RowForm
        label="Rename category"
        submitLabel="Save name"
        pending={pending}
        error={error}
        onCancel={close}
        onSubmit={() =>
          save({ name, parentId: row.parentId }, "Couldn’t rename the category. Try again.")
        }
      >
        <NameField value={name} onChange={setName} disabled={pending} />
      </RowForm>
    );
  }

  if (mode === "move") {
    return (
      <RowForm
        label="Move category"
        submitLabel="Move category"
        pending={pending}
        error={error}
        onCancel={close}
        onSubmit={() =>
          save(
            { name: row.name, parentId: selectedParentId || null },
            "Couldn’t move the category. Try again.",
          )
        }
      >
        <label className="min-w-0 text-sm font-medium">
          Group
          <select
            value={selectedParentId}
            onChange={(event) => setParentId(event.target.value)}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Top level</option>
            {groups
              .filter((group) => group.id !== row.id)
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </select>
        </label>
      </RowForm>
    );
  }

  return (
    <div ref={actions} className="mt-1 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        aria-label={`Rename ${row.name}`}
        data-action="rename"
        onClick={() => open("rename")}
        className={actionClass}
      >
        Rename
      </button>
      {row.movable && (
        <button
          type="button"
          aria-label={`Move ${row.name}`}
          data-action="move"
          onClick={() => open("move")}
          className={actionClass}
        >
          Move
        </button>
      )}
    </div>
  );
}
