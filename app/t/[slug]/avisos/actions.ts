"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth";
import { orderAlertsDbApi, schema, withTenant } from "@/lib/db";
import { allow } from "@/lib/orders/rate-limit";
import { sendTelegram, telegramConfigured } from "@/lib/telegram/client";
import { parseChatId, testAlertMessage } from "@/lib/telegram/rules";

export type AvisosResult = { ok: true } | { ok: false; message: string };

/** Só o administrador do restaurante (ou a Factoria) altera para onde vão os pedidos. */
async function admin(slug: string) {
  const { tenant, role } = await requireTenantAccess(slug);
  if (role === "tenant_operator") return { tenant, erro: "Só o administrador do restaurante pode alterar os avisos." };
  if (!telegramConfigured()) return { tenant, erro: "O Telegram ainda não está configurado no servidor." };
  return { tenant, erro: null };
}

function falha(err: unknown, message: string): AvisosResult {
  if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
  console.error("[avisos]", err instanceof Error ? err.message : err);
  return { ok: false, message };
}

export async function salvarAvisos(slug: string, chatIdRaw: string, ligado: boolean): Promise<AvisosResult> {
  const { tenant, erro } = await admin(slug);
  if (erro) return { ok: false, message: erro };
  const vazio = String(chatIdRaw ?? "").trim() === "";
  const chatId = vazio ? null : parseChatId(chatIdRaw);
  if (!vazio && !chatId) return { ok: false, message: "ID do chat inválido. Use só números (o de grupo começa com -)." };
  if (ligado === true && !chatId) return { ok: false, message: "Informe o ID do chat antes de ligar os avisos." };
  try {
    await orderAlertsDbApi.set(tenant.id, { telegramChatId: chatId, enabled: ligado === true });
    revalidatePath(`/t/${tenant.slug}/avisos`);
    return { ok: true };
  } catch (err) {
    return falha(err, "Não foi possível salvar agora. Tente de novo em instantes.");
  }
}

/** Manda uma mensagem de teste para o chat informado (antes ou depois de salvar). */
export async function testarAvisos(slug: string, chatIdRaw: string): Promise<AvisosResult> {
  const { tenant, erro } = await admin(slug);
  if (erro) return { ok: false, message: erro };
  const chatId = parseChatId(chatIdRaw);
  if (!chatId) return { ok: false, message: "ID do chat inválido. Use só números (o de grupo começa com -)." };
  if (!allow(`telegram-teste:${tenant.id}`, 5, 10 * 60_000)) {
    return { ok: false, message: "Muitos testes seguidos. Aguarde alguns minutos." };
  }
  try {
    const [info] = await withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants));
    await sendTelegram(chatId, testAlertMessage(info.name));
    return { ok: true };
  } catch (err) {
    return falha(err, "O Telegram não aceitou a mensagem. Confira o ID e se o bot foi adicionado ao grupo.");
  }
}
