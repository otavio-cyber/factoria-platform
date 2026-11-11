/**
 * Aplica as migrations pendentes (produção). Roda como factoria_owner.
 * No container: node dist-scripts/migrate.mjs   (MIGRATIONS_DATABASE_URL vem de migrate.env)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATIONS_DATABASE_URL;
if (!url) {
  console.error("MIGRATIONS_DATABASE_URL não definida");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "lib/db/migrations" });
  console.log("✓ migrations aplicadas");
} catch (err) {
  console.error("✗ falha nas migrations:", err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
