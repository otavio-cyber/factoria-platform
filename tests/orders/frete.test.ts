/** Frete por distância: faixas, bairro pelo CEP, taxa de retorno e bairro sem distância. */
import { describe, expect, it } from "vitest";
import { parseDistancesCsv } from "@/lib/orders/import-distances";
import {
  bandFor,
  checkoutSchema,
  deliveryFee,
  districtKey,
  needsReturnTrip,
  parseBands,
  parseKm,
  PICKNGO_BANDS,
  quoteOrder,
  type CepInfo,
  type DeliveryContext,
  type District,
  type MenuSnapshot,
  type OrderSettings,
} from "@/lib/orders/rules";

const pick = parseBands(PICKNGO_BANDS);
if (!pick.ok) throw new Error("tabela Pick'n'Go inválida");
const bands = pick.bands;
const ctx: DeliveryContext = { bands, policy: "confirm", tenantCity: "Ribeirão Preto" };
const s = { deliveryFeeCents: 2000 };
const bairros: District[] = [
  { nameKey: districtKey("Jardim América"), feeCents: 0, active: true, distanceM: 1000 },
  { nameKey: districtKey("Ribeirânia"), feeCents: 0, active: true, distanceM: 5200 },
  { nameKey: districtKey("Bonfim Paulista"), feeCents: 0, active: true, distanceM: 19500 },
  { nameKey: districtKey("Vila Virgínia"), feeCents: 0, active: false, distanceM: 3000 },
  { nameKey: districtKey("Sumarezinho"), feeCents: 0, active: true, distanceM: null },
];
const cep = (district: string | null, city = "Ribeirão Preto"): CepInfo => ({ status: "ok", street: "Rua X", district, city, state: "SP" });

describe("faixas", () => {
  it("tabela Pick'n'Go: 9 faixas de 2 km, de R$ 9,90 a R$ 25,90, retorno pela metade", () => {
    expect(bands).toHaveLength(9);
    expect(bands[0]).toEqual({ fromM: 0, toM: 2000, feeCents: 990, returnFeeCents: 495 });
    expect(bands[8]).toEqual({ fromM: 16000, toM: 18000, feeCents: 2590, returnFeeCents: 1295 });
  });
  it("limite exato fica na faixa de baixo; acima do último km = fora da área", () => {
    expect(bandFor(bands, 0)?.feeCents).toBe(990);
    expect(bandFor(bands, 2000)?.feeCents).toBe(990);
    expect(bandFor(bands, 2001)?.feeCents).toBe(1190);
    expect(bandFor(bands, 18000)?.feeCents).toBe(2590);
    expect(bandFor(bands, 18001)).toBeNull();
  });
  it("km aceita vírgula ou ponto; inválido e acima de 200 km são recusados", () => {
    expect(parseKm("3,5")).toBe(3500);
    expect(parseKm("3.25")).toBe(3250);
    expect(parseKm("")).toBeNull();
    for (const v of ["abc", "-1", "3,555", "201"]) expect(parseKm(v)).toBeUndefined();
  });
  it("tabela digitada: cada faixa começa onde a anterior termina e precisa ser crescente", () => {
    expect(parseBands([{ ateKm: "2", frete: "9,90", retorno: "" }, { ateKm: "5", frete: "12", retorno: "6" }])).toEqual({
      ok: true,
      bands: [{ fromM: 0, toM: 2000, feeCents: 990, returnFeeCents: 0 }, { fromM: 2000, toM: 5000, feeCents: 1200, returnFeeCents: 600 }],
    });
    expect(parseBands([{ ateKm: "4", frete: "9", retorno: "" }, { ateKm: "3", frete: "9", retorno: "" }]).ok).toBe(false);
    expect(parseBands([{ ateKm: "2", frete: "abc", retorno: "" }]).ok).toBe(false);
  });
});

describe("frete da entrega", () => {
  it("taxa de retorno só na maquininha (cartão ou Pix), não no dinheiro", () => {
    expect([needsReturnTrip("card"), needsReturnTrip("pix"), needsReturnTrip("cash")]).toEqual([true, true, false]);
    expect(deliveryFee("", "card", s, bairros, ctx, cep("Ribeirânia"))).toMatchObject({ ok: true, feeCents: 1390, returnFeeCents: 695, distanceM: 5200 });
    expect(deliveryFee("", "cash", s, bairros, ctx, cep("Ribeirânia"))).toMatchObject({ ok: true, feeCents: 1390, returnFeeCents: 0 });
  });
  it("o bairro que vale é o do CEP, não o digitado (não dá para trocar o bairro e pagar menos)", () => {
    const f = deliveryFee("Jardim América", "cash", s, bairros, ctx, cep("Ribeirânia"));
    expect(f).toMatchObject({ ok: true, feeCents: 1390, district: "Ribeirânia" });
  });
  it("CEP inexistente, outra cidade, bairro bloqueado e fora da área são recusados", () => {
    expect(deliveryFee("", "cash", s, bairros, ctx, { status: "not_found" })).toMatchObject({ ok: false, field: "address.zip" });
    expect(deliveryFee("", "cash", s, bairros, ctx, cep("Centro", "Sertãozinho"))).toMatchObject({ ok: false });
    expect(deliveryFee("", "cash", s, bairros, ctx, cep("Vila Virgínia"))).toMatchObject({ ok: false });
    expect(deliveryFee("", "cash", s, bairros, ctx, cep("Bonfim Paulista"))).toMatchObject({ ok: false });
  });
  it("bairro sem distância: frete a confirmar (padrão) ou recusado, conforme a regra do restaurante", () => {
    expect(deliveryFee("", "card", s, bairros, ctx, cep("Sumarezinho"))).toMatchObject({ ok: true, pending: true, feeCents: 0, returnFeeCents: 0, district: "Sumarezinho" });
    expect(deliveryFee("", "card", s, bairros, ctx, cep("Lagoinha"))).toMatchObject({ ok: true, pending: true, district: "Lagoinha" });
    expect(deliveryFee("", "card", s, bairros, { ...ctx, policy: "block" }, cep("Lagoinha"))).toMatchObject({ ok: false });
  });
  it("ViaCEP fora do ar: o pedido entra com frete a confirmar", () => {
    expect(deliveryFee("Ribeirânia", "cash", s, bairros, ctx, { status: "unavailable" })).toMatchObject({ ok: true, pending: true });
  });
  it("sem faixas, nada muda: taxa do bairro ou a padrão, sem retorno", () => {
    const porBairro: District[] = [{ nameKey: districtKey("Centro"), feeCents: 800, active: true }];
    const semFaixas: DeliveryContext = { bands: [], policy: "confirm", tenantCity: null };
    expect(deliveryFee("centro", "card", s, porBairro, semFaixas)).toMatchObject({ ok: true, feeCents: 800, returnFeeCents: 0, pending: false });
    expect(deliveryFee("Ipiranga", "card", s, porBairro, semFaixas)).toMatchObject({ ok: true, feeCents: 2000 });
  });
});

describe("pedido completo", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const menu: MenuSnapshot = [{ id: A, name: "Churras Mista", priceCents: 4300, promoPriceCents: null, available: true, categoryActive: true }];
  const set: OrderSettings = { ordersEnabled: true, deliveryEnabled: true, pickupEnabled: true, minOrderCents: 0, deliveryFeeCents: 2000, isOpen: true };
  const pedido = (o: object = {}) =>
    checkoutSchema.parse({
      items: [{ id: A, quantity: 2 }], type: "delivery", name: "Ana", phone: "(16) 99999-1234", paymentMethod: "card",
      address: { zip: "14020-240", street: "Av. A", number: "1", complement: "", district: "Ribeirânia", city: "", state: "SP", reference: "" },
      ...o,
    });
  it("total = itens + frete + retorno", () => {
    expect(quoteOrder(pedido(), set, menu, bairros, ctx, cep("Ribeirânia"))).toMatchObject({
      ok: true, subtotalCents: 8600, deliveryFeeCents: 1390, returnFeeCents: 695, feePending: false, totalCents: 10685,
    });
  });
  it("retirada não tem frete nem retorno", () => {
    expect(quoteOrder(pedido({ type: "pickup", address: undefined }), set, menu, bairros, ctx)).toMatchObject({ ok: true, deliveryFeeCents: 0, returnFeeCents: 0, totalCents: 8600 });
  });
  it("entrega exige CEP com 8 números", () => {
    const r = checkoutSchema.safeParse({ ...pedido(), phone: "(16) 99999-1234", address: { zip: "1402", street: "Av. A", number: "1", district: "X", state: "SP" } });
    expect(r.success).toBe(false);
  });
});

describe("planilha de distâncias (CSV)", () => {
  it("lê ; e vírgula decimal, ignora sem distância e marca 'Não' como não entregamos", () => {
    const csv = "﻿Bairro;Distância (km);Entrega?;Frete (R$)\nJardim América;1;Sim;9,90\nRibeirânia;5,2;Sim;\nCentro;;Sim;\nBonfim Paulista;;Não;\n";
    expect(parseDistancesCsv(csv)).toEqual({
      ok: true,
      skipped: 1,
      rows: [
        { name: "Jardim América", distanceM: 1000, active: true },
        { name: "Ribeirânia", distanceM: 5200, active: true },
        { name: "Bonfim Paulista", distanceM: null, active: false },
      ],
    });
  });
  it("aponta distância inválida, bairro repetido e cabeçalho errado", () => {
    expect(parseDistancesCsv("Bairro,Distância (km)\nCentro,abc\n").ok).toBe(false);
    expect(parseDistancesCsv("Bairro;Distância (km)\nCentro;1\ncentro;2\n").ok).toBe(false);
    expect(parseDistancesCsv("Nome;Km\nCentro;1\n").ok).toBe(false);
  });
});
