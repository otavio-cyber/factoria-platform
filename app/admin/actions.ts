"use server";

import { revalidatePath } from "next/cache";
import {
  adminChangeOwnerEmail,
  adminProvisionChatwoot,
  adminRegenerateActivationLink,
  requireSuperAdmin,
} from "@/lib/auth";
import { OnboardingError } from "@/lib/onboarding/create-tenant";

export type SuporteResult = { ok: true; email: string; activationUrl: string } | { ok: false; message: string };

function falha(err: unknown, contexto: string): SuporteResult {
  if (err instanceof OnboardingError) return { ok: false, message: err.message };
  console.error(`[admin] ${contexto}`, err);
  return { ok: false, message: "Não foi possível concluir. Tente de novo." };
}

export async function gerarNovoLink(tenantId: string, userId: string): Promise<SuporteResult> {
  const { proof } = await requireSuperAdmin(); // Server Action = endpoint público: checa aqui
  try {
    const r = await adminRegenerateActivationLink(proof, { tenantId, userId });
    return { ok: true, email: r.email, activationUrl: r.activationUrl };
  } catch (err) {
    return falha(err, "falha ao gerar link");
  }
}

export async function corrigirEmailDono(tenantId: string, userId: string, novoEmail: string): Promise<SuporteResult> {
  const { proof } = await requireSuperAdmin();
  try {
    const r = await adminChangeOwnerEmail(proof, { tenantId, userId, newEmail: novoEmail });
    revalidatePath("/admin");
    return { ok: true, email: r.email, activationUrl: r.activationUrl! };
  } catch (err) {
    return falha(err, "falha ao corrigir e-mail");
  }
}

export async function configurarAtendimento(tenantId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { proof } = await requireSuperAdmin();
  try {
    await adminProvisionChatwoot(proof, tenantId);
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    revalidatePath("/admin"); // mostra o erro registrado
    if (err instanceof OnboardingError) return { ok: false, message: err.message };
    console.error("[admin] falha ao configurar atendimento", err);
    return { ok: false, message: "Não foi possível configurar o atendimento." };
  }
}
