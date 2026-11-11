/** Regras do pedido: o servidor recalcula tudo e recusa o que não pode. */
import { describe, expect, it } from "vitest";
import { allow } from "@/lib/orders/rate-limit";
import {
  checkoutSchema,
  districtKey,
  nextStatus,
  parseChangeFor,
  quoteOrder,
  type MenuSnapshot,
  type OrderSettings,
} from "@/lib/orders/rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const menu: MenuSnapshot = [
  { id: A, name: "Churras de Linguiça", priceCents: 3990, promoPriceCents: 3190, available: true, categoryActive: true },
  { id: B, name: "Picanha 200grs", priceCents: 3499, promoPriceCents: null, available: true, categoryActive: true },
];
const s: OrderSettings = { ordersEnabled: true, deliveryEnabled: true, pickupEnabled: true, minOrderCents: 2000, deliveryFeeCents: 2000, isOpen: true };
const base = {
  items: [{ id: A, quantity: 2, notes: "sem cebola" }],
  type: "delivery" as const,
  name: "Maria",
  phone: "(16) 99999-8888",
  address: { zip: "14000-000", street: "Rua A", number: "10", complement: "", district: "Jardim América", city: "Ribeirão Preto", state: "SP", reference: "" },
  paymentMethod: "cash" as const,
};
const parse = (o: object) => checkoutSchema.parse({ ...base, ...o });

describe("quoteOrder", () => {
  it("usa o preço do BANCO (promocional), não o que o navegador mandar", () => {
    const q = quoteOrder(parse({}), s, menu, []);
    expect(q).toMatchObject({ ok: true, subtotalCents: 6380, deliveryFeeCents: 2000, totalCents: 8380 });
    if (q.ok) expect(q.lines[0]).toMatchObject({ name: "Churras de Linguiça", unitPriceCents: 3190, quantity: 2, notes: "sem cebola", lineTotalCents: 6380 });
  });
  it("taxa do bairro da tabela (sem diferença de acento/maiúsculas); fora da tabela, taxa padrão", () => {
    const tabela = [{ nameKey: districtKey("Jardim América"), feeCents: 800, active: true }];
    expect(quoteOrder(parse({ address: { ...base.address, district: "jardim america" } }), s, menu, tabela)).toMatchObject({ deliveryFeeCents: 800 });
    expect(quoteOrder(parse({ address: { ...base.address, district: "Centro" } }), s, menu, tabela)).toMatchObject({ deliveryFeeCents: 2000 });
  });
  it("retirada não cobra taxa", () => {
    expect(quoteOrder(parse({ type: "pickup", address: undefined }), s, menu, [])).toMatchObject({ ok: true, deliveryFeeCents: 0, totalCents: 6380 });
  });
  it("recusa: fechado, pedidos desligados, item pausado ou inexistente, abaixo do mínimo, bairro bloqueado", () => {
    expect(quoteOrder(parse({}), { ...s, isOpen: false }, menu, []).ok).toBe(false);
    expect(quoteOrder(parse({}), { ...s, ordersEnabled: false }, menu, []).ok).toBe(false);
    expect(quoteOrder(parse({}), { ...s, deliveryEnabled: false }, menu, []).ok).toBe(false);
    expect(quoteOrder(parse({}), s, [{ ...menu[0], available: false }], []).ok).toBe(false);
    expect(quoteOrder(parse({ items: [{ id: "33333333-3333-4333-8333-333333333333", quantity: 1 }] }), s, menu, []).ok).toBe(false);
    expect(quoteOrder(parse({ items: [{ id: A, quantity: 1 }] }), { ...s, minOrderCents: 5000 }, menu, []).ok).toBe(false);
    const bloqueado = [{ nameKey: districtKey("Jardim América"), feeCents: 0, active: false }];
    expect(quoteOrder(parse({}), s, menu, bloqueado)).toMatchObject({ ok: false, message: expect.stringMatching(/não entregamos/i) });
  });
});

describe("checkout", () => {
  it("entrega exige rua, número e bairro; retirada não", () => {
    expect(checkoutSchema.safeParse({ ...base, address: { ...base.address, street: "" } }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, type: "pickup", address: undefined }).success).toBe(true);
  });
  it("telefone vira E.164; quantidade e itens têm limite", () => {
    expect(parse({}).phone).toBe("+5516999998888");
    expect(checkoutSchema.safeParse({ ...base, items: [{ id: A, quantity: 100 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
  it("pagamento: dinheiro, cartão ou Pix (na entrega/retirada); outra forma é recusada", () => {
    for (const m of ["cash", "card", "pix"]) expect(checkoutSchema.safeParse({ ...base, paymentMethod: m }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, paymentMethod: "boleto" }).success).toBe(false);
  });
});

describe("troco", () => {
  it("vazio = sem troco; precisa ser maior que o total", () => {
    expect(parseChangeFor("", 8380)).toEqual({ ok: true, cents: null });
    expect(parseChangeFor("100,00", 8380)).toEqual({ ok: true, cents: 10000 });
    expect(parseChangeFor("50", 8380).ok).toBe(false);
  });
});

describe("etapas", () => {
  it("entrega: recebido → preparo → saiu → entregue; retirada: … → pronto → entregue", () => {
    expect(nextStatus("received", "delivery")).toBe("preparing");
    expect(nextStatus("preparing", "delivery")).toBe("out_for_delivery");
    expect(nextStatus("preparing", "pickup")).toBe("ready");
    expect(nextStatus("ready", "pickup")).toBe("delivered");
    expect(nextStatus("delivered", "pickup")).toBeNull();
    expect(nextStatus("canceled", "delivery")).toBeNull();
  });
});

describe("limite de envios", () => {
  it("bloqueia depois do máximo na janela e libera depois", () => {
    const k = `teste-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(allow(k, 3, 1000, 0)).toBe(true);
    expect(allow(k, 3, 1000, 10)).toBe(false);
    expect(allow(k, 3, 1000, 2000)).toBe(true);
  });
});
