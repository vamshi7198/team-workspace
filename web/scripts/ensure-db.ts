// Creates the database named in `url` if it doesn't exist yet (test/e2e databases on a fresh
// dev Postgres). Connects to the server's "postgres" maintenance database to do it.
import postgres from "postgres";

export async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unexpected database name: ${name}`);
  target.pathname = "/postgres";
  const sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql`select 1 from pg_database where datname = ${name}`;
    if (!row) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }
}

// CLI: `tsx scripts/ensure-db.ts` creates the database in DATABASE_URL (used by Playwright,
// whose web server health check needs the database before global setup runs).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/ensure-db.ts")) {
  ensureDatabase(process.env.DATABASE_URL ?? "").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
