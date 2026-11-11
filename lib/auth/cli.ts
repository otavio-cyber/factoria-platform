// Só para a CLI do Better Auth gerar o schema (`pnpm auth:generate`). Não é usado pelo app.
import { makeDb } from "@/lib/db/core";
import { createAuth } from "./config";

export const auth = createAuth(makeDb(process.env.DATABASE_URL ?? "postgres://localhost/unused").db);
