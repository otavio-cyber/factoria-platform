/**
 * Regra de acesso a um tenant — função pura, testada isoladamente.
 * Resposta "not_found" (e não "forbidden") para não revelar que o restaurante existe.
 */
import type { TenantRole } from "@/lib/db/core";

export type AccessRole = TenantRole | "super_admin";
export type AccessDecision = { allowed: true; role: AccessRole } | { allowed: false; reason: "not_found" };

export function decideTenantAccess(input: {
  userRole: string | null | undefined;
  tenantStatus: string | null; // null = tenant não existe
  membershipRole: TenantRole | null;
}): AccessDecision {
  const { userRole, tenantStatus, membershipRole } = input;
  if (tenantStatus === null) return { allowed: false, reason: "not_found" };
  // Equipe Factoria entra em qualquer tenant (inclusive suspenso, para suporte).
  if (userRole === "super_admin") return { allowed: true, role: "super_admin" };
  if (tenantStatus !== "active") return { allowed: false, reason: "not_found" };
  if (!membershipRole) return { allowed: false, reason: "not_found" };
  return { allowed: true, role: membershipRole };
}

/**
 * Prova (em tempo de compilação) de que a sessão foi validada como super admin.
 * Só requireSuperAdmin() (lib/auth) cria este valor; operações de admin o exigem
 * como parâmetro — impossível chamá-las "sem querer" sem checar a sessão.
 */
declare const superAdminBrand: unique symbol;
export type SuperAdminProof = { readonly [superAdminBrand]: true; readonly userId: string };

export function issueSuperAdminProof(user: { id: string; role?: string | null }): SuperAdminProof | null {
  return user.role === "super_admin" ? ({ userId: user.id } as SuperAdminProof) : null;
}
