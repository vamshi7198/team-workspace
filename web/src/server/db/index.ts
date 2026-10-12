import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const create = (client: postgres.Sql) => drizzle(client, { schema, casing: "snake_case" });
type Database = ReturnType<typeof create>;

const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql; db?: Database };

// Connect on first use, not at import: `next build` imports route modules to collect page
// config, and there is no DATABASE_URL (or database) at build time, e.g. inside Docker.
function instance(): Database {
  if (!globalForDb.db) {
    if (!globalForDb.pgClient) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is not set");
      globalForDb.pgClient = postgres(url, { max: 10, idle_timeout: 30, onnotice: () => {} });
    }
    globalForDb.db = create(globalForDb.pgClient);
  }
  return globalForDb.db;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = instance();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
