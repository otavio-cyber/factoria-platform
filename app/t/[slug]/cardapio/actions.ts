"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireTenantAccess } from "@/lib/auth";
import { menu, MenuError } from "@/lib/db";
import { mediaStorage } from "@/lib/media/storage";
import { categorySchema, itemSchema } from "@/lib/menu/rules";

export type MenuResult = { ok: true } | { ok: false; message: string; fields: Record<string, string> };

const NAO_PODE = "Só o administrador do restaurante pode alterar o cardápio.";

/** Checa sessão e acesso. `editar`: só dono (tenant_admin) e Factoria; senão, qualquer membro. */
async function acesso(slug: string, editar: boolean) {
  const { tenant, role } = await requireTenantAccess(slug); // 404 sem acesso
  return { tenant, bloqueado: editar && role === "tenant_operator" };
}

function invalido(error: z.ZodError): MenuResult {
  const fields: Record<string, string> = {};
  for (const i of error.issues) fields[String(i.path[0] ?? "")] ??= i.message;
  return { ok: false, message: error.issues[0]?.message ?? "Dados inválidos", fields };
}

async function executar(slug: string, editar: boolean, fn: (tenantId: string) => Promise<unknown>): Promise<MenuResult> {
  const a = await acesso(slug, editar);
  if (a.bloqueado) return { ok: false, message: NAO_PODE, fields: {} };
  try {
    await fn(a.tenant.id);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    if (err instanceof MenuError) return { ok: false, message: err.message, fields: {} };
    console.error("[cardapio]", err);
    return { ok: false, message: "Não foi possível salvar agora. Tente de novo.", fields: {} };
  }
  revalidatePath(`/t/${a.tenant.slug}/cardapio`);
  return { ok: true };
}

export async function salvarCategoria(slug: string, id: string | null, input: unknown): Promise<MenuResult> {
  const p = categorySchema.safeParse(input);
  if (!p.success) return invalido(p.error);
  return executar(slug, true, (t) => (id ? menu.updateCategory(t, id, p.data) : menu.createCategory(t, p.data)));
}

export async function excluirCategoria(slug: string, id: string) {
  return executar(slug, true, (t) => menu.deleteCategory(t, id));
}

export async function moverCategoria(slug: string, id: string, dir: "up" | "down") {
  return executar(slug, true, (t) => menu.moveCategory(t, id, dir));
}

export async function salvarItem(slug: string, id: string | null, input: unknown): Promise<MenuResult> {
  const p = itemSchema.safeParse(input);
  if (!p.success) return invalido(p.error);
  return executar(slug, true, (t) => (id ? menu.updateItem(t, id, p.data) : menu.createItem(t, p.data)));
}

export async function excluirItem(slug: string, id: string) {
  return executar(slug, true, async (t) => {
    const foto = await menu.deleteItem(t, id);
    if (foto) await mediaStorage().delete(foto).catch((e) => console.error("[cardapio] apagar foto", e));
  });
}

export async function moverItem(slug: string, id: string, dir: "up" | "down") {
  return executar(slug, true, (t) => menu.moveItem(t, id, dir));
}

/** Pausar quando acaba: qualquer pessoa da equipe pode. */
export async function pausarItem(slug: string, id: string, available: boolean) {
  return executar(slug, false, (t) => menu.setItemAvailable(t, id, available));
}
