import type { Metadata } from "next";

import { listCategoryTree } from "@/lib/data/categories";
import { AddCategory, CategoryActions } from "./category-controls";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const tree = await listCategoryTree();
  const groups = tree.map(({ id, name }) => ({ id, name }));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Groups hold the categories you assign to transactions. Add, rename, and move them so the
        tree matches how you actually think.
      </p>
      <AddCategory parentId={null} />
      <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tree.map((group) => (
          <section
            key={group.id}
            data-testid="category-group"
            aria-labelledby={`category-${group.id}`}
            className="py-4"
          >
            <div data-testid="group-row">
              <h2 id={`category-${group.id}`} className="text-base font-medium">
                {group.name}
              </h2>
              <CategoryActions
                row={{
                  id: group.id,
                  name: group.name,
                  parentId: null,
                  retired: group.retiredAt !== null,
                  movable: group.categories.length === 0,
                }}
                groups={groups}
              />
            </div>
            {group.categories.length > 0 && (
              <ul className="mt-3 divide-y divide-zinc-100 pl-4 dark:divide-zinc-900">
                {group.categories.map((leaf) => (
                  <li key={leaf.id} data-testid="category-row" className="py-2">
                    <p className="text-sm">{leaf.name}</p>
                    <CategoryActions
                      row={{
                        id: leaf.id,
                        name: leaf.name,
                        parentId: group.id,
                        retired: leaf.retiredAt !== null,
                        movable: true,
                      }}
                      groups={groups}
                    />
                  </li>
                ))}
              </ul>
            )}
            <AddCategory parentId={group.id} groupName={group.name} />
          </section>
        ))}
      </div>
    </>
  );
}
