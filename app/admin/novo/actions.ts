"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminCreateTenant, requireSuperAdmin, type ChatwootOutcome } from "@/lib/auth";
import { OnboardingError, type CreateTenantInput } from "@/lib/onboarding/create-tenant";

export type NovoRestauranteState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fields?: Partial<Record<keyof CreateTenantInput | "ownerEmailConfirm", string>>;
      values: CreateTenantInput & { ownerEmailConfirm?: string };
    }
  | {
      status: "ok";
      name: string;
      slug: string;
      ownerEmail: string;
      ownerIsNew: boolean;
      activationUrl: string | null;
      chatwoot: ChatwootOutcome;
    };

export async function criarRestaurante(_prev: NovoRestauranteState, formData: FormData): Promise<NovoRestauranteState> {
  // Server Actions são endpoints públicos: a checagem acontece AQUI, não só na página.
  const { proof } = await requireSuperAdmin();

  const values: CreateTenantInput = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    timezone: String(formData.get("timezone") ?? "America/Sao_Paulo"),
    ownerName: String(formData.get("ownerName") ?? ""),
    ownerEmail: String(formData.get("ownerEmail") ?? ""),
  };

  // Confirmação do e-mail do dono: um erro de digitação aqui deixa o dono sem acesso.
  const confirm = String(formData.get("ownerEmailConfirm") ?? "");
  if (values.ownerEmail.trim().toLowerCase() !== confirm.trim().toLowerCase()) {
    return {
      status: "error",
      message: "Os e-mails do responsável não conferem.",
      fields: { ownerEmailConfirm: "Digite o mesmo e-mail nos dois campos." },
      values: { ...values, ownerEmailConfirm: confirm },
    };
  }

  try {
    const r = await adminCreateTenant(proof, values);
    revalidatePath("/admin");
    return {
      status: "ok",
      name: values.name.trim(),
      slug: r.slug,
      ownerEmail: values.ownerEmail.trim().toLowerCase(),
      ownerIsNew: r.ownerIsNew,
      activationUrl: r.activationUrl,
      chatwoot: r.chatwoot,
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const fields: Partial<Record<keyof CreateTenantInput | "ownerEmailConfirm", string>> = {};
      for (const issue of err.issues) {
        const key = issue.path[0] as keyof CreateTenantInput;
        fields[key] ??= issue.message;
      }
      return { status: "error", message: "Revise os campos destacados.", fields, values };
    }
    if (err instanceof OnboardingError) {
      return { status: "error", message: err.message, fields: err.field ? { [err.field]: err.message } : undefined, values };
    }
    console.error("[onboarding] falha ao criar restaurante", err);
    return { status: "error", message: "Não foi possível criar o restaurante. Tente de novo.", values };
  }
}
