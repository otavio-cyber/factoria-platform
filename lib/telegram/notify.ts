/**
 * Aviso de pedido novo para a equipe, no grupo do Telegram do restaurante.
 * Sempre "melhor esforço": roda depois da resposta (after) e nunca quebra o pedido se o Telegram falhar.
 */
import "server-only";
import { after } from "next/server";
import { orderAlertsDbApi } from "@/lib/db";
import { sendTelegram, telegramConfigured } from "./client";
import { orderAlertMessage } from "./rules";

function panelUrl(slug: string): string | null {
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/t/${slug}/pedidos` : null;
}

async function enviar(tenantId: string, token: string) {
  if (!telegramConfigured()) return;
  try {
    const a = await orderAlertsDbApi.alert(tenantId, token);
    if (!a) return; // avisos desligados, sem chat ou pedido inexistente
    const texto = orderAlertMessage({ ...a.order, items: a.items, panelUrl: panelUrl(a.slug) });
    await sendTelegram(a.chatId, texto);
  } catch (err) {
    // Sem dados do cliente no log: só o restaurante e o motivo.
    console.error("[telegram] aviso de pedido falhou", { tenantId, erro: err instanceof Error ? err.message : String(err) });
  }
}

/** Agenda o aviso para depois da resposta (o checkout não espera o Telegram). */
export function alertNewOrder(tenantId: string, token: string) {
  after(() => enviar(tenantId, token));
}
