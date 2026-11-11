/**
 * Aviso do pedido ao cliente pelo WhatsApp do restaurante. Sempre "melhor esforço":
 * roda depois da resposta (after) e nunca quebra o pedido se o WhatsApp falhar.
 */
import "server-only";
import { after } from "next/server";
import { whatsappDbApi } from "@/lib/db";
import type { OrderStatus, OrderType } from "@/lib/orders/rules";
import { evolutionConfigured, sendText } from "./evolution";
import { orderStatusMessage, toWhatsappNumber } from "./rules";

function trackUrl(o: { customDomain: string | null; slug: string; publicToken: string }) {
  if (o.customDomain) return `https://${o.customDomain}/p/${o.publicToken}`;
  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  return `${base}/c/${o.slug}/p/${o.publicToken}`;
}

async function enviar(tenantId: string, by: { id: string } | { token: string }) {
  if (!evolutionConfigured()) return;
  try {
    const o = await whatsappDbApi.orderNotice(tenantId, by);
    if (!o) return; // sem conexão, avisos desligados ou pedido inexistente
    const texto = orderStatusMessage({
      status: o.status as OrderStatus,
      type: o.type as OrderType,
      number: o.number,
      customerName: o.customerName,
      restaurantName: o.restaurantName,
      trackUrl: trackUrl(o),
      cancelReason: o.cancelReason,
    });
    await sendText(tenantId, toWhatsappNumber(o.customerPhone), texto);
  } catch (err) {
    // Sem dados do cliente no log: só o restaurante e o motivo.
    console.error("[whatsapp] aviso do pedido falhou", { tenantId, erro: err instanceof Error ? err.message : String(err) });
  }
}

/** Agenda o aviso para depois da resposta (o painel e o checkout não esperam o WhatsApp). */
export function notifyOrder(tenantId: string, by: { id: string } | { token: string }) {
  after(() => enviar(tenantId, by));
}
