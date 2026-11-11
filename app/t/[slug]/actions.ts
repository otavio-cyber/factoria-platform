"use server";

import { redirect } from "next/navigation";
import { launchChatwoot } from "@/lib/auth";
import { OnboardingError } from "@/lib/onboarding/create-tenant";

/**
 * "Abrir atendimento": gera o link de login automático no Chatwoot (vale 5 min) e redireciona.
 * Server Action (POST) de propósito: nada de GET que gere token por prefetch ou por link externo.
 */
export async function abrirAtendimento(slug: string): Promise<{ message: string }> {
  let url: string;
  try {
    url = await launchChatwoot(slug); // checa sessão e acesso ao restaurante
  } catch (err) {
    if (err instanceof OnboardingError) return { message: err.message };
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err; // redirect/notFound do Next
    console.error("[atendimento] falha ao gerar link", err);
    return { message: "Não foi possível abrir o atendimento agora. Tente de novo." };
  }
  redirect(url);
}
