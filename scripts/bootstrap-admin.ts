/**
 * Cria (ou reativa) um SUPER ADMIN em produção, sem senha no código:
 * senha aleatória + link de ativação (48 h, uso único) impresso no terminal.
 *
 *   node dist-scripts/bootstrap-admin.mjs email@dominio "Nome"
 *
 * Se o e-mail já é super admin: só gera um novo link (ex.: perdeu a senha).
 * Se o e-mail existe como usuário comum: recusa (promoção a super admin não é feita por aqui).
 */
import { randomBytes } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { captureResetLink } from "@/lib/auth/activation";
import { createAuth } from "@/lib/auth/config";
import { makeDb } from "@/lib/db/core";
import { user, verification } from "@/lib/db/schema";

const [email, ...nome] = process.argv.slice(2);
const name = nome.join(" ").trim();
if (!email || !email.includes("@")) {
  console.error('uso: node dist-scripts/bootstrap-admin.mjs email@dominio "Nome"');
  process.exit(2);
}

const { db, close } = makeDb(process.env.DATABASE_URL!, { max: 1 });
const auth = createAuth(db);
try {
  const alvo = email.trim().toLowerCase();
  let [u] = await db.select().from(user).where(eq(user.email, alvo));
  if (u && u.role !== "super_admin") {
    throw new Error(`${alvo} já existe como usuário comum; não é promovido por este script.`);
  }
  if (!u) {
    if (!name) throw new Error('informe o nome: node dist-scripts/bootstrap-admin.mjs email "Nome"');
    await auth.api.createUser({
      body: { email: alvo, name, password: randomBytes(24).toString("base64url"), role: "super_admin" },
    });
    [u] = await db.select().from(user).where(eq(user.email, alvo));
    console.log(`✓ super admin criado: ${alvo}`);
  } else {
    console.log(`• ${alvo} já é super admin: gerando novo link`);
  }
  await db.delete(verification).where(and(like(verification.identifier, "reset-password:%"), eq(verification.value, u.id)));
  const link = await captureResetLink(() => auth.api.requestPasswordReset({ body: { email: alvo, redirectTo: "/ativar" } }));
  console.log(`\nLink de ativação (48 h, uso único) — abra você mesmo, não compartilhe:\n${link}\n`);
} catch (err) {
  console.error("✗", (err as Error).message);
  process.exitCode = 1;
} finally {
  await close();
}
