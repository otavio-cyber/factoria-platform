import { existsSync } from "node:fs";

// O Next não carrega .env.local quando NODE_ENV=test (comportamento intencional dele).
// Localmente lemos .env.local direto; no CI as variáveis já vêm do ambiente.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

for (const name of ["DATABASE_URL", "MIGRATIONS_DATABASE_URL"]) {
  if (!process.env[name]) throw new Error(`${name} não definida — copie .env.example para .env.local`);
}
