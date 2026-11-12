/** Opening the database: Postgres in production, in-process PGlite for tests and local play. */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { SQL } from "bun";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import { migrate as migrateBun } from "drizzle-orm/bun-sql/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = join(import.meta.dir, "..", "..", "drizzle");

/** `url` is a postgres:// URL; without one, a PGlite database in `dataDir` (or in memory). */
export async function openDatabase(url?: string, dataDir?: string): Promise<{ db: Database; close(): Promise<void> }> {
  if (url) {
    const client = new SQL(url);
    const db = drizzleBun({ client, schema, casing: "snake_case" });
    await migrateBun(db, { migrationsFolder });
    return { db: db as unknown as Database, close: () => client.close() };
  }
  const client = new PGlite(dataDir);
  const db = drizzlePglite({ client, schema, casing: "snake_case" });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Database, close: () => client.close() };
}
