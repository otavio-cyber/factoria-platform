import { databaseHealthy } from "@/lib/db";

// Usado pelo healthcheck do container e pelo deploy (rollback automático se falhar).
// Não expõe nada sensível: só "ok" e a versão (commit) em execução.
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await databaseHealthy();
  return Response.json(
    { ok: db, db: db ? "ok" : "erro", version: process.env.APP_VERSION ?? "dev" },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
