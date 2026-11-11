/**
 * Integração do restaurante com o Chatwoot (1.4b).
 *
 * provisionChatwoot: cria (se faltar) a conta do restaurante no Chatwoot e coloca cada membro
 *   como AGENTE (nunca administrador: admins do Chatwoot podem criar webhooks para a rede interna).
 *   Idempotente: pode ser repetido após falha parcial sem duplicar nada.
 * chatwootLaunchUrl: link de login automático (SSO, 5 min) do usuário logado no atendimento.
 */
import { eq, sql } from "drizzle-orm";
import type { SuperAdminProof } from "@/lib/auth/access";
import { chatwootEmailFor, type ChatwootPlatform } from "@/lib/chatwoot/platform";
import { withSuperAdminOn, withTenantOn, type Db } from "@/lib/db/core";
import { chatwootUsers, memberships, tenants, user } from "@/lib/db/schema";
import { OnboardingError } from "./create-tenant";

type Deps = { db: Db; cw: ChatwootPlatform };

function accountPrefix(): string {
  return process.env.CHATWOOT_ACCOUNT_PREFIX ?? (process.env.NODE_ENV === "production" ? "" : "[dev] ");
}

async function readTenant(db: Db, tenantId: string) {
  const [t] = await withTenantOn(db, tenantId, (tx) =>
    tx
      .select({ name: tenants.name, chatwootAccountId: tenants.chatwootAccountId })
      .from(tenants)
      .where(eq(tenants.id, tenantId)),
  );
  if (!t) throw new OnboardingError("Restaurante não encontrado.");
  return t;
}

async function ensureChatwootUser(deps: Deps, u: { id: string; name: string }): Promise<number> {
  const [existente] = await deps.db
    .select({ id: chatwootUsers.chatwootUserId })
    .from(chatwootUsers)
    .where(eq(chatwootUsers.userId, u.id));
  if (existente) return existente.id;

  const criado = await deps.cw.createUser({ name: u.name, email: chatwootEmailFor(u.id) });
  const [ligado] = await withSuperAdminOn(deps.db, (tx) =>
    tx.execute<{ id: string }>(sql`select factoria_admin_link_chatwoot_user(${u.id}, ${criado.id}) as id`),
  );
  return Number(ligado.id);
}

async function setError(db: Db, tenantId: string, message: string | null) {
  await withSuperAdminOn(db, (tx) => tx.execute(sql`select factoria_admin_set_chatwoot_error(${tenantId}, ${message})`));
}

export async function provisionChatwoot(
  deps: Deps,
  _proof: SuperAdminProof,
  tenantId: string,
): Promise<{ accountId: number; agents: number }> {
  try {
    const t = await readTenant(deps.db, tenantId);

    let accountId = t.chatwootAccountId;
    if (!accountId) {
      const conta = await deps.cw.createAccount({ name: `${accountPrefix()}${t.name}` });
      accountId = conta.id;
      await withSuperAdminOn(deps.db, (tx) =>
        tx.execute(sql`select factoria_admin_set_chatwoot_account(${tenantId}, ${accountId})`),
      );
    }

    const membros = await withTenantOn(deps.db, tenantId, (tx) =>
      tx
        .select({ id: memberships.userId, name: user.name })
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId)),
    );
    for (const m of membros) {
      const cwUserId = await ensureChatwootUser(deps, m);
      await deps.cw.addAccountUser({ accountId, userId: cwUserId, role: "agent" });
    }

    await setError(deps.db, tenantId, null);
    return { accountId, agents: membros.length };
  } catch (err) {
    const motivo = (err as Error).message || "erro desconhecido";
    await setError(deps.db, tenantId, motivo).catch(() => {});
    throw new OnboardingError(`Não foi possível configurar o atendimento: ${motivo}`);
  }
}

/** Link de login automático no Chatwoot para `userId` no restaurante `tenantId`. */
export async function chatwootLaunchUrl(deps: Deps, input: { tenantId: string; userId: string }): Promise<string> {
  const t = await readTenant(deps.db, input.tenantId);
  if (!t.chatwootAccountId) throw new OnboardingError("O atendimento deste restaurante ainda não foi configurado.");
  const [ligacao] = await deps.db
    .select({ id: chatwootUsers.chatwootUserId })
    .from(chatwootUsers)
    .where(eq(chatwootUsers.userId, input.userId));
  if (!ligacao) throw new OnboardingError("Seu usuário ainda não tem acesso ao atendimento. Fale com a Factoria.");
  return deps.cw.ssoLoginUrl(ligacao.id);
}
