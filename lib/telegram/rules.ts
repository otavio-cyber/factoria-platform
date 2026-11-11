/**
 * Aviso de pedido novo para a equipe do restaurante, pelo Telegram.
 * Regras puras (sem rede): validação do ID do chat e o texto da mensagem.
 */
import { formatBrl } from "@/lib/menu/rules";
import { PAYMENT_LABEL } from "@/lib/orders/rules";
import { formatPhoneBr } from "@/lib/tenants/profile";

/** ID de chat do Telegram: grupo (negativo, ex.: -1001234567890) ou conversa privada. */
export const CHAT_ID = /^-?[0-9]{5,20}$/;

export function parseChatId(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return CHAT_ID.test(v) ? v : null;
}

export type OrderAlertInput = {
  restaurantName: string;
  number: number;
  type: string; // delivery | pickup
  customerName: string;
  customerPhone: string; // E.164
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressReference: string | null;
  notes: string | null;
  paymentMethod: string; // cash | card | pix
  changeForCents: number | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  returnFeeCents?: number;
  feePending?: boolean;
  totalCents: number;
  items: Array<{ name: string; quantity: number; notes: string | null; lineTotalCents: number }>;
  panelUrl: string | null;
};

/** Texto simples (sem Markdown), para nenhum dado digitado pelo cliente quebrar a formatação. */
export function orderAlertMessage(o: OrderAlertInput): string {
  const entrega = o.type === "delivery";
  const l: string[] = [`🔔 Novo pedido #${o.number} – ${entrega ? "Entrega" : "Retirada"}`, o.restaurantName, ""];

  l.push(`Cliente: ${o.customerName}`, `Telefone: ${formatPhoneBr(o.customerPhone)}`);
  if (entrega) {
    const rua = [o.addressStreet, o.addressNumber, o.addressComplement].filter(Boolean).join(", ");
    const cidade = [o.addressCity, o.addressState].filter(Boolean).join("/");
    l.push(`Endereço: ${rua} – ${[o.addressDistrict, cidade].filter(Boolean).join(", ")}`);
    if (o.addressReference) l.push(`Referência: ${o.addressReference}`);
  }

  l.push("", "Itens:");
  for (const i of o.items) {
    l.push(`${i.quantity}x ${i.name} – ${formatBrl(i.lineTotalCents)}`);
    if (i.notes) l.push(`   obs: ${i.notes}`);
  }

  l.push("", `Subtotal: ${formatBrl(o.subtotalCents)}`);
  if (entrega && o.feePending) l.push("Taxa de entrega: A CONFIRMAR (bairro sem distância cadastrada: combine com o cliente)");
  else if (entrega) l.push(`Taxa de entrega: ${o.deliveryFeeCents > 0 ? formatBrl(o.deliveryFeeCents) : "grátis"}`);
  if ((o.returnFeeCents ?? 0) > 0) l.push(`Taxa de retorno (maquininha): ${formatBrl(o.returnFeeCents ?? 0)}`);
  l.push(`Total: ${formatBrl(o.totalCents)}${o.feePending ? " + entrega" : ""}`);

  const pagamento = PAYMENT_LABEL[o.paymentMethod as keyof typeof PAYMENT_LABEL] ?? o.paymentMethod;
  const troco = o.paymentMethod === "cash" && o.changeForCents ? ` (troco para ${formatBrl(o.changeForCents)})` : "";
  l.push(`Pagamento: ${pagamento}${troco}`);

  if (o.notes) l.push("", `Obs. do pedido: ${o.notes}`);
  if (o.panelUrl) l.push("", `Abrir no painel: ${o.panelUrl}`);

  // Limite do Telegram: 4096 caracteres por mensagem.
  const texto = l.join("\n");
  return texto.length > 4000 ? `${texto.slice(0, 3990)}\n…` : texto;
}

export function testAlertMessage(restaurantName: string): string {
  return `✅ Teste de avisos de pedido – ${restaurantName}\nTudo certo: os pedidos novos vão chegar neste chat.`;
}
