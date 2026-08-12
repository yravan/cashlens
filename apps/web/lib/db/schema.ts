import { sql } from "drizzle-orm";
import {
  pgPolicy,
  pgRole,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const appRole = pgRole("cashlens_app").existing();

// Every user-owned table gets RLS policies scoped to the request's verified
// Clerk user id (set per transaction by withRequestScope); tables added
// without them fail the RLS coverage test in e2e/isolation.signed-in.spec.ts.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    pgPolicy("users_select_self", {
      for: "select",
      to: appRole,
      using: sql`clerk_user_id = current_setting('app.clerk_user_id', true)`,
    }),
    pgPolicy("users_insert_self", {
      for: "insert",
      to: appRole,
      withCheck: sql`clerk_user_id = current_setting('app.clerk_user_id', true)`,
    }),
  ],
);
