/**
 * Onboarding de restaurante (etapa 1.4a): cria tenant + dono + vínculo e gera o link de ativação.
 *
 * Serviço sem dependência do Next (recebe db/auth por parâmetro) para ser testável.
 * Quem chama PRECISA ter validado super admin antes (a prova é exigida pelo tipo).
 *
 * Ordem pensada para falhas parciais:
 *   1. valida tudo (slug livre, dados)            → nada criado se falhar
 *   2. acha/cria o usuário do dono                → se o resto falhar, o usuário fica sem vínculo
 *                                                   (inofensivo; é reaproveitado ao tentar de novo)
 *   3. cria o tenant (função do super admin)
 *   4. cria o vínculo tenant_admin
 *   5. gera o link de ativação (só para usuário novo)
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SuperAdminProof } from "@/lib/auth/access";
import { captureResetLink } from "@/lib/auth/activation";
import type { Auth } from "@/lib/auth/config";
import { adminCreateTenantOn, resolveTenantOn, withTenantOn, type Db } from "@/lib/db/core";
import { memberships, user } from "@/lib/db/schema";
import { slugError } from "@/lib/tenants/slug";

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do restaurante.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .superRefine((s, ctx) => {
      const erro = slugError(s);
      if (erro) ctx.addIssue({ code: "custom", message: erro });
    }),
  timezone: z.string().trim().min(1).default("America/Sao_Paulo"),
  ownerName: z.string().trim().min(2, "Informe o nome do responsável.").max(120),
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido.")), // limpa antes de validar
});

export type CreateTenantInput = z.input<typeof createTenantSchema>;

export type CreateTenantResult = {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  ownerIsNew: boolean;
  /** Link para o dono criar a senha (só quando o usuário é novo). */
  activationUrl: string | null;
};

export class OnboardingError extends Error {
  constructor(
    message: string,
    readonly field?: keyof CreateTenantInput,
  ) {
    super(message);
  }
}

export async function createTenantWithOwner(
  deps: { db: Db; auth: Auth },
  _proof: SuperAdminProof,
  rawInput: CreateTenantInput,
): Promise<CreateTenantResult> {
  const input = createTenantSchema.parse(rawInput);
  const { db, auth } = deps;

  // 1. slug livre?
  if (await resolveTenantOn(db, input.slug)) {
    throw new OnboardingError("Já existe um restaurante com este endereço.", "slug");
  }

  // 2. dono: reaproveita se o e-mail já existe (ex.: dono de outro restaurante)
  let [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, input.ownerEmail));
  const ownerIsNew = !owner;
  if (!owner) {
    // Senha aleatória que ninguém conhece: o dono define a dele pelo link de ativação.
    await auth.api.createUser({
      body: {
        email: input.ownerEmail,
        name: input.ownerName,
        password: randomBytes(24).toString("base64url"),
        role: "user",
      },
    });
    [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, input.ownerEmail));
  }

  // 3. tenant
  let tenantId: string;
  try {
    tenantId = await adminCreateTenantOn(db, { slug: input.slug, name: input.name, timezone: input.timezone });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new OnboardingError("Já existe um restaurante com este endereço.", "slug");
    if (code === "22023") throw new OnboardingError("Fuso horário inválido.", "timezone");
    throw err;
  }

  // 4. vínculo do dono
  await withTenantOn(db, tenantId, (tx) =>
    tx.insert(memberships).values({ tenantId, userId: owner.id, role: "tenant_admin" }),
  );

  // 5. link de ativação (usuário novo)
  const activationUrl = ownerIsNew
    ? await captureResetLink(() =>
        auth.api.requestPasswordReset({ body: { email: input.ownerEmail, redirectTo: "/ativar" } }),
      )
    : null;

  return { tenantId, slug: input.slug, ownerUserId: owner.id, ownerIsNew, activationUrl };
}
