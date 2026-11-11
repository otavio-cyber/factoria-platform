/**
 * Suporte ao dono do restaurante (super admin): novo link de ativação e correção de e-mail.
 * Mesmo padrão do create-tenant: dependências por parâmetro + prova de super admin no tipo.
 */
import { and, eq, like, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { SuperAdminProof } from "@/lib/auth/access";
import { captureResetLink } from "@/lib/auth/activation";
import type { Auth } from "@/lib/auth/config";
import { withSuperAdminOn, type Db } from "@/lib/db/core";
import { memberships, session, user, verification } from "@/lib/db/schema";
import { OnboardingError } from "./create-tenant";

type Deps = { db: Db; auth: Auth };
type OwnerRef = { tenantId: string; userId: string };

/** Garante que userId é administrador (tenant_admin) deste tenant — evita mexer em usuário errado. */
async function assertOwner(db: Db, { tenantId, userId }: OwnerRef) {
  const rows = await withSuperAdminOn(db, (tx) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.role, "tenant_admin")))
      .limit(1),
  );
  if (!rows.length) throw new OnboardingError("Este usuário não é administrador deste restaurante.");
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!u) throw new OnboardingError("Usuário não encontrado.");
  return u;
}

/** Invalida links de ativação/redefinição anteriores deste usuário (só o mais novo vale). */
async function revokeResetLinks(db: Db, userId: string) {
  await db
    .delete(verification)
    .where(and(like(verification.identifier, "reset-password:%"), eq(verification.value, userId)));
}

async function newLink(deps: Deps, userId: string, email: string) {
  await revokeResetLinks(deps.db, userId);
  return captureResetLink(() => deps.auth.api.requestPasswordReset({ body: { email, redirectTo: "/ativar" } }));
}

/** Gera um novo link de ativação (ou de redefinição, se o dono já ativou). Links antigos param de funcionar. */
export async function regenerateActivationLink(deps: Deps, _proof: SuperAdminProof, ref: OwnerRef) {
  const { email } = await assertOwner(deps.db, ref);
  const url = await newLink(deps, ref.userId, email);
  if (!url) throw new OnboardingError("Não foi possível gerar o link. Tente de novo.");
  return { email, activationUrl: url };
}

// Limpa ANTES de validar (e-mail colado com espaço ou maiúscula é comum).
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("E-mail inválido."));

/**
 * Corrige o e-mail do dono (ex.: erro de digitação no cadastro).
 * Encerra as sessões abertas e invalida links antigos; devolve um link novo para o e-mail certo.
 */
export async function changeOwnerEmail(
  deps: Deps,
  _proof: SuperAdminProof,
  ref: OwnerRef & { newEmail: string },
) {
  const parsed = emailSchema.safeParse(ref.newEmail);
  if (!parsed.success) throw new OnboardingError("E-mail inválido.");
  const newEmail = parsed.data;

  const atual = await assertOwner(deps.db, ref);
  if (atual.email === newEmail) throw new OnboardingError("O e-mail informado é o mesmo de hoje.");

  const emUso = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, newEmail), ne(user.id, ref.userId)))
    .limit(1);
  if (emUso.length) throw new OnboardingError("Este e-mail já pertence a outro usuário.");

  await deps.db
    .update(user)
    .set({ email: newEmail, emailVerified: false, updatedAt: sql`now()` })
    .where(eq(user.id, ref.userId));
  await deps.db.delete(session).where(eq(session.userId, ref.userId)); // derruba sessões abertas

  const activationUrl = await newLink(deps, ref.userId, newEmail);
  return { email: newEmail, activationUrl };
}
