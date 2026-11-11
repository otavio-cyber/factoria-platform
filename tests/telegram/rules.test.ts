import { describe, expect, it } from "vitest";
import { orderAlertMessage, parseChatId, type OrderAlertInput } from "@/lib/telegram/rules";

const base: OrderAlertInput = {
  restaurantName: "Casa Exemplo",
  number: 128,
  type: "delivery",
  customerName: "Maria Souza",
  customerPhone: "+5516991234567",
  addressStreet: "Rua X",
  addressNumber: "123",
  addressComplement: "ap 12",
  addressDistrict: "Jardim América",
  addressCity: "Ribeirão Preto",
  addressState: "SP",
  addressReference: "portão azul",
  notes: null,
  paymentMethod: "cash",
  changeForCents: 15000,
  subtotalCents: 9899,
  deliveryFeeCents: 800,
  totalCents: 10699,
  items: [
    { name: "Churras Mista", quantity: 2, notes: null, lineTotalCents: 8600 },
    { name: "Maionese de Ovos 400g", quantity: 1, notes: "sem cebola", lineTotalCents: 1299 },
  ],
  panelUrl: "https://app.factoria.dev.br/t/alta-brasa/pedidos",
};
const nb = (s: string) => s.replace(/ /g, " ");

describe("ID do chat do Telegram", () => {
  it("aceita grupo (negativo) e conversa privada", () => {
    expect(parseChatId("-1001234567890")).toBe("-1001234567890");
    expect(parseChatId(" 123456789 ")).toBe("123456789");
  });
  it("recusa texto, @usuário, link e números curtos", () => {
    for (const v of ["", "abc", "@grupo", "https://t.me/x", "12", "-1001234567890; drop", null, undefined]) {
      expect(parseChatId(v)).toBeNull();
    }
  });
});

describe("mensagem do pedido novo", () => {
  it("entrega: cliente, endereço, itens com obs, taxa, total e troco", () => {
    const m = nb(orderAlertMessage(base));
    expect(m).toContain("🔔 Novo pedido #128 – Entrega");
    expect(m).toContain("Cliente: Maria Souza");
    expect(m).toContain("Telefone: (16) 99123-4567");
    expect(m).toContain("Endereço: Rua X, 123, ap 12 – Jardim América, Ribeirão Preto/SP");
    expect(m).toContain("Referência: portão azul");
    expect(m).toContain("2x Churras Mista – R$ 86,00");
    expect(m).toContain("1x Maionese de Ovos 400g – R$ 12,99\n   obs: sem cebola");
    expect(m).toContain("Taxa de entrega: R$ 8,00");
    expect(m).toContain("Total: R$ 106,99");
    expect(m).toContain("Pagamento: Dinheiro (troco para R$ 150,00)");
    expect(m).toContain("Abrir no painel: https://app.factoria.dev.br/t/alta-brasa/pedidos");
  });

  it("retirada: sem endereço nem taxa; cartão sem troco; observação do pedido", () => {
    const m = nb(
      orderAlertMessage({
        ...base, type: "pickup", paymentMethod: "card", changeForCents: null, deliveryFeeCents: 0,
        totalCents: 9899, notes: "buzinar", panelUrl: null,
      }),
    );
    expect(m).toContain("– Retirada");
    expect(m).not.toContain("Endereço");
    expect(m).not.toContain("Taxa de entrega");
    expect(m).toContain("Pagamento: Cartão (na entrega/retirada)");
    expect(m).not.toContain("troco");
    expect(m).toContain("Obs. do pedido: buzinar");
    expect(m).not.toContain("Abrir no painel");
  });

  it("Pix aparece como forma de pagamento, sem troco", () => {
    const m = nb(orderAlertMessage({ ...base, paymentMethod: "pix", changeForCents: null }));
    expect(m).toContain("Pagamento: Pix (na entrega/retirada)");
    expect(m).not.toContain("troco");
  });

  it("taxa de retorno aparece separada e entra no total", () => {
    const m = nb(orderAlertMessage({ ...base, paymentMethod: "card", changeForCents: null, returnFeeCents: 695, totalCents: 11394 }));
    expect(m).toContain("Taxa de retorno (maquininha): R$ 6,95");
    expect(m).toContain("Total: R$ 113,94");
  });

  it("frete a confirmar aparece em destaque para a equipe combinar com o cliente", () => {
    const m = nb(orderAlertMessage({ ...base, deliveryFeeCents: 0, feePending: true, totalCents: 9899 }));
    expect(m).toContain("Taxa de entrega: A CONFIRMAR");
    expect(m).toContain("Total: R$ 98,99 + entrega");
  });

  it("entrega grátis aparece como grátis", () => {
    expect(nb(orderAlertMessage({ ...base, deliveryFeeCents: 0, totalCents: 9899 }))).toContain("Taxa de entrega: grátis");
  });

  it("nunca passa do limite do Telegram", () => {
    const muitos = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i} com nome comprido`, quantity: 1, notes: "observação longa ".repeat(3), lineTotalCents: 100 }));
    expect(orderAlertMessage({ ...base, items: muitos }).length).toBeLessThanOrEqual(4000);
  });
});
