import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  config({ path: ".env.test", quiet: true });
  const url = process.env.DATABASE_URL!;
  if (!/_test\b/.test(url)) throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
