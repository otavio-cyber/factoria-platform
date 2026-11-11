/**
 * Camada de acesso (DAL) de autenticação/autorização — padrão recomendado pelo Next 16:
 * checar sessão e permissão PERTO DOS DADOS (em cada página, Server Action e Route Handler),
 * não no layout. O proxy.ts faz só uma checagem otimista (existe cookie?).
 */
import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { appDb, getTenantRole, listUserTenants, resolveTenantBySlug } from "@/lib/db";
import { adminListTenantsOn, adminSetCustomDomainOn, adminSetTenantFiscalOn } from "@/lib/db/core";
import { createTenantWithOwner, type CreateTenantInput } from "@/lib/onboarding/create-tenant";
import { changeOwnerEmail, regenerateActivationLink } from "@/lib/onboarding/owner-support";
import { chatwootFromEnv } from "@/lib/chatwoot/platform";
import { chatwootLaunchUrl, provisionChatwoot } from "@/lib/onboarding/chatwoot";
import { OnboardingError } from "@/lib/onboarding/create-tenant";
import { decideTenantAccess, issueSuperAdminProof, type AccessRole, type SuperAdminProof } from "./access";
import { createAuth, type Auth } from "./config";

const globalForAuth = globalThis as unknown as { __factoriaAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__factoriaAuth ??= createAuth(appDb());
  return globalForAuth.__factoriaAuth;
}

/** Sessão atual (memoizada por requisição). null = não logado. */
export const getSession = cache(async () => {
  // headers() PRIMEIRO: marca a rota como dinâmica antes de tocar no banco
  // (senão o build tenta pré-renderizar a página e exige DATABASE_URL).
  const h = await headers();
  return getAuth().api.getSession({ headers: h });
});

/** Usuário logado ou redireciona para /login. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export type TenantAccess = {
  user: Awaited<ReturnType<typeof requireUser>>;
  tenant: { id: string; slug: string; timezone: string };
  role: AccessRole;
};

/**
 * Garante que o usuário logado pode acessar o tenant `slug`.
 * Sem acesso → 404 (não revela se o restaurante existe).
 */
export const requireTenantAccess = cache(async (slug: string): Promise<TenantAccess> => {
  const user = await requireUser();
  const tenant = await resolveTenantBySlug(slug);
  const membershipRole = tenant && user.role !== "super_admin" ? await getTenantRole(tenant.id, user.id) : null;

  const decision = decideTenantAccess({
    userRole: user.role,
    tenantStatus: tenant?.status ?? null,
    membershipRole,
  });
  if (!decision.allowed || !tenant) notFound();

  return { user, tenant: { id: tenant.id, slug: slug.toLowerCase(), timezone: tenant.timezone }, role: decision.role };
});

/** Restaurantes do usuário logado. */
export async function myTenants() {
  const user = await requireUser();
  return { user, tenants: await listUserTenants(user.id) };
}

/** Garante super admin. Qualquer outro usuário recebe 404 (a área /admin "não existe"). */
export async function requireSuperAdmin(): Promise<{ user: TenantAccess["user"]; proof: SuperAdminProof }> {
  const user = await requireUser();
  const proof = issueSuperAdminProof(user);
  if (!proof) notFound();
  return { user, proof };
}

// ─── Operações do super admin (exigem a prova) ─────────────────────────────
export function adminListTenants(_proof: SuperAdminProof) {
  return adminListTenantsOn(appDb());
}

export type ChatwootOutcome = { status: "ok"; accountId: number } | { status: "erro"; message: string } | { status: "desativado" };

/** Cria o restaurante e, se a integração estiver configurada, já provisiona o Chatwoot. */
export async function adminCreateTenant(proof: SuperAdminProof, input: CreateTenantInput) {
  const criado = await createTenantWithOwner({ db: appDb(), auth: getAuth() }, proof, input);
  let chatwoot: ChatwootOutcome = { status: "desativado" };
  const cw = chatwootFromEnv();
  if (cw) {
    // Falha no Chatwoot NÃO desfaz o restaurante: fica registrada e dá para tentar de novo no /admin.
    chatwoot = await provisionChatwoot({ db: appDb(), cw }, proof, criado.tenantId)
      .then((r): ChatwootOutcome => ({ status: "ok", accountId: r.accountId }))
      .catch((err): ChatwootOutcome => ({ status: "erro", message: (err as Error).message }));
  }
  return { ...criado, chatwoot };
}

function chatwootOrThrow() {
  const cw = chatwootFromEnv();
  if (!cw) throw new OnboardingError("Integração com o Chatwoot não configurada (CHATWOOT_URL / CHATWOOT_PLATFORM_TOKEN).");
  return cw;
}

export function adminSetTenantFiscal(
  _proof: SuperAdminProof,
  tenantId: string,
  input: { legalName: string | null; cnpj: string | null },
) {
  return adminSetTenantFiscalOn(appDb(), tenantId, input);
}

export function adminSetCustomDomain(_proof: SuperAdminProof, tenantId: string, domain: string | null) {
  return adminSetCustomDomainOn(appDb(), tenantId, domain);
}

export function adminProvisionChatwoot(proof: SuperAdminProof, tenantId: string) {
  return provisionChatwoot({ db: appDb(), cw: chatwootOrThrow() }, proof, tenantId);
}

/** Link de login automático no atendimento para o usuário logado (checa o acesso ao restaurante). */
export async function launchChatwoot(slug: string): Promise<string> {
  const { user, tenant } = await requireTenantAccess(slug);
  return chatwootLaunchUrl({ db: appDb(), cw: chatwootOrThrow() }, { tenantId: tenant.id, userId: user.id });
}

export function adminRegenerateActivationLink(proof: SuperAdminProof, ref: { tenantId: string; userId: string }) {
  return regenerateActivationLink({ db: appDb(), auth: getAuth() }, proof, ref);
}

export function adminChangeOwnerEmail(
  proof: SuperAdminProof,
  ref: { tenantId: string; userId: string; newEmail: string },
) {
  return changeOwnerEmail({ db: appDb(), auth: getAuth() }, proof, ref);
}
