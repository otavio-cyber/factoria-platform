/**
 * WhatsApp — regras puras (sem rede, sem banco), testadas.
 * Mensagens de aviso do pedido, formato do número e leitura dos eventos da Evolution API.
 */
import type { OrderStatus, OrderType } from "@/lib/orders/rules";

export type WhatsappStatus = "disconnected" | "connecting" | "connected";

const PREFIXO = "factoria-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Nome da instância na Evolution: um por restaurante, derivado do id (nada a adivinhar). */
export const instanceNameFor = (tenantId: string) => `${PREFIXO}${tenantId}`;

/** De volta do nome da instância para o restaurante (eventos da Evolution). Nome estranho → null. */
export function tenantIdFromInstance(name: unknown): string | null {
  if (typeof name !== "string" || !name.startsWith(PREFIXO)) return null;
  const id = name.slice(PREFIXO.length);
  return UUID.test(id) ? id : null;
}

/** "+5516999998888" → "5516999998888" (formato que a Evolution espera). */
export const toWhatsappNumber = (e164: string) => e164.replace(/\D/g, "");

/** Estado da Evolution ("open" | "connecting" | "close" | …) → nosso status. */
export function mapState(state: unknown): WhatsappStatus {
  if (state === "open") return "connected";
  if (state === "connecting") return "connecting";
  return "disconnected";
}

/** "5516999998888@s.whatsapp.net" → "5516999998888". */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string") return null;
  const d = jid.split("@")[0].replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export type OrderMessageInput = {
  status: OrderStatus;
  type: OrderType;
  number: number;
  customerName: string;
  restaurantName: string;
  trackUrl: string;
  cancelReason?: string | null;
};

/** Texto do aviso para cada etapa do pedido. Curto, sem link encurtado, só o que o cliente precisa. */
export function orderStatusMessage(o: OrderMessageInput): string {
  const primeiroNome = o.customerName.trim().split(/\s+/)[0] || "";
  const n = `#${o.number}`;
  switch (o.status) {
    case "received":
      return `Olá, ${primeiroNome}! Recebemos seu pedido ${n} na ${o.restaurantName}.\nAcompanhe por aqui: ${o.trackUrl}`;
    case "preparing":
      return `Seu pedido ${n} está em preparo.`;
    case "out_for_delivery":
      return `Seu pedido ${n} saiu para entrega.`;
    case "ready":
      return `Seu pedido ${n} está pronto para retirada.`;
    case "delivered":
      return o.type === "pickup"
        ? `Pedido ${n} retirado. Obrigado pela preferência!`
        : `Pedido ${n} entregue. Obrigado pela preferência!`;
    case "canceled":
      return `Seu pedido ${n} foi cancelado.${o.cancelReason ? ` Motivo: ${o.cancelReason}.` : ""} Se tiver dúvidas, é só responder esta mensagem.`;
  }
}

/** Evento recebido da Evolution, já validado. Só o que usamos hoje: mudança de conexão. */
export type EvolutionEvent =
  | { kind: "connection"; tenantId: string; status: WhatsappStatus; phone: string | null }
  | { kind: "ignored" };

export function parseEvolutionEvent(body: unknown): EvolutionEvent {
  if (!body || typeof body !== "object") return { kind: "ignored" };
  const b = body as { event?: unknown; instance?: unknown; data?: { state?: unknown; wuid?: unknown } };
  const tenantId = tenantIdFromInstance(b.instance);
  if (!tenantId) return { kind: "ignored" };
  const ev = typeof b.event === "string" ? b.event.toLowerCase().replace(/_/g, ".") : "";
  if (ev === "connection.update") {
    return { kind: "connection", tenantId, status: mapState(b.data?.state), phone: phoneFromJid(b.data?.wuid) };
  }
  return { kind: "ignored" };
}
