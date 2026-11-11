import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Mesmo carregamento de .env que o Next (.env.local, .env.development...).
loadEnvConfig(process.cwd());

const url = process.env.MIGRATIONS_DATABASE_URL;
if (!url) throw new Error("MIGRATIONS_DATABASE_URL não definida (veja .env.example)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  // Migrations rodam como factoria_owner (dono do schema) — NUNCA como factoria_app.
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
