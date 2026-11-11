"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { adminSetCustomDomain, adminSetTenantFiscal, requireSuperAdmin, requireTenantAccess } from "@/lib/auth";
import { updateTenantProfile } from "@/lib/db";
import { customDomainSchema, fiscalSchema, profileSchema } from "@/lib/tenants/profile";

export type SalvarDadosResult =
  | { ok: true }
  | { ok: false; message: string; fields: Record<string, string> };

function falha(error: z.ZodError): SalvarDadosResult {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] === "openingHours" ? "openingHours" : String(issue.path[0] ?? "");
    fields[key] ??= issue.message;
  }
  return { ok: false, message: error.issues[0]?.message ?? "Dados inválidos", fields };
}

/** Salva os dados do restaurante. Operacionais: dono e Factoria. Fiscais: só a Factoria. */
export async function salvarDados(
  slug: string,
  input: { profile: unknown; fiscal?: unknown; customDomain?: unknown },
): Promise<SalvarDadosResult> {
  const { tenant, role } = await requireTenantAccess(slug); // 404 sem acesso
  if (role === "tenant_operator") {
    return { ok: false, message: "Só o administrador do restaurante pode alterar estes dados.", fields: {} };
  }

  const profile = profileSchema.safeParse(input.profile);
  if (!profile.success) return falha(profile.error);

  let fiscal: z.output<typeof fiscalSchema> | null = null;
  if (role === "super_admin" && input.fiscal !== undefined) {
    const f = fiscalSchema.safeParse(input.fiscal);
    if (!f.success) return falha(f.error);
    fiscal = f.data;
  }
  let dominio: { value: string | null } | null = null;
  if (role === "super_admin" && input.customDomain !== undefined) {
    const d = customDomainSchema.safeParse(input.customDomain);
    if (!d.success) return { ok: false, message: d.error.issues[0].message, fields: { customDomain: d.error.issues[0].message } };
    dominio = { value: d.data };
  }

  try {
    await updateTenantProfile(tenant.id, profile.data);
    if (fiscal || dominio) {
      const { proof } = await requireSuperAdmin();
      if (fiscal) await adminSetTenantFiscal(proof, tenant.id, fiscal);
      if (dominio) await adminSetCustomDomain(proof, tenant.id, dominio.value);
    }
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") {
      const msg = "Esse domínio já está em uso por outro restaurante.";
      return { ok: false, message: msg, fields: { customDomain: msg } };
    }
    console.error("[dados] falha ao salvar", err);
    return { ok: false, message: "Não foi possível salvar agora. Tente de novo.", fields: {} };
  }

  revalidatePath(`/t/${tenant.slug}`, "layout");
  return { ok: true };
}
