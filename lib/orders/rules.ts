/**
 * Regras do pedido — puras e testadas. O servidor SEMPRE recalcula tudo a partir do banco:
 * o navegador só diz "quais itens e quantos"; preço, taxa e total nunca vêm do cliente.
 */
import { z } from "zod";
import { effectivePrice, parseBrl } from "@/lib/menu/rules";
import { onlyDigits, phoneToE164, UFS } from "@/lib/tenants/profile";

export const ORDER_STATUS = {
  received: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto para retirada",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  canceled: "Cancelado",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;
export type OrderType = "delivery" | "pickup";

export const PAYMENT_LABEL = { cash: "Dinheiro", card: "Cartão (na entrega/retirada)", pix: "Pix (na entrega/retirada)" } as const;

/** Próxima etapa do pedido (o botão do painel). Entregue e cancelado não avançam. */
export function nextStatus(status: OrderStatus, type: OrderType): OrderStatus | null {
  switch (status) {
    case "received":
      return "preparing";
    case "preparing":
      return type === "delivery" ? "out_for_delivery" : "ready";
    case "ready":
    case "out_for_delivery":
      return "delivered";
    default:
      return null;
  }
}

/** Etapas mostradas ao cliente, na ordem. */
export const statusSteps = (type: OrderType): OrderStatus[] =>
  type === "delivery" ? ["received", "preparing", "out_for_delivery", "delivered"] : ["received", "preparing", "ready", "delivered"];

/** Chave de comparação do bairro: "Jardim  América" e "jardim america" são o mesmo bairro. */
export const districtKey = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// ─── o que o cliente envia ──────────────────────────────────────────────────
const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).transform((v) => (v === "" ? null : v));

export const checkoutSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.uuid(),
          quantity: z.number().int().min(1).max(99),
          notes: opcional(140).default(""),
        }),
      )
      .min(1, "O carrinho está vazio.")
      .max(50),
    type: z.enum(["delivery", "pickup"]),
    name: texto(80).min(2, "Informe seu nome."),
    phone: z.string().transform((v, ctx) => {
      const e = phoneToE164(v);
      if (!e) {
        ctx.addIssue({ code: "custom", message: "Telefone inválido. Use DDD + número." });
        return z.NEVER;
      }
      return e;
    }),
    address: z
      .object({
        zip: z.string().transform(onlyDigits),
        street: opcional(120),
        number: opcional(20),
        complement: opcional(60),
        district: opcional(80),
        city: opcional(80),
        state: z.string().trim().toUpperCase().transform((v) => ((UFS as readonly string[]).includes(v) ? v : null)),
        reference: opcional(120),
      })
      .optional(),
    notes: opcional(300).default(""),
    paymentMethod: z.enum(["cash", "card", "pix"], { error: "Escolha a forma de pagamento." }),
    changeFor: z.string().default(""),
  })
  .superRefine((o, ctx) => {
    if (o.type !== "delivery") return;
    const a = o.address;
    if (!a?.street) ctx.addIssue({ code: "custom", path: ["address", "street"], message: "Informe a rua." });
    if (!a?.number) ctx.addIssue({ code: "custom", path: ["address", "number"], message: "Informe o número." });
    if (!a?.district) ctx.addIssue({ code: "custom", path: ["address", "district"], message: "Informe o bairro." });
    if (a?.zip.length !== 8) ctx.addIssue({ code: "custom", path: ["address", "zip"], message: "Informe o CEP (8 números)." });
  });
export type CheckoutInput = z.input<typeof checkoutSchema>;
export type Checkout = z.output<typeof checkoutSchema>;

// ─── cálculo ────────────────────────────────────────────────────────────────
export type MenuSnapshot = Array<{ id: string; name: string; priceCents: number; promoPriceCents: number | null; available: boolean; categoryActive: boolean }>;
export type OrderSettings = {
  ordersEnabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderCents: number;
  deliveryFeeCents: number;
  isOpen: boolean;
};
export type District = { nameKey: string; feeCents: number; active: boolean; distanceM?: number | null };

/** Faixa de frete por distância: vale para distâncias em (fromM, toM]; a primeira faixa inclui o 0. */
export type FeeBand = { fromM: number; toM: number; feeCents: number; returnFeeCents: number };
export type UnknownDistrictPolicy = "confirm" | "block";
/** O que o ViaCEP disse sobre o CEP do cliente (consultado pelo servidor). */
export type CepInfo =
  | { status: "ok"; street: string | null; district: string | null; city: string; state: string }
  | { status: "not_found" }
  | { status: "unavailable" };
export type DeliveryContext = { bands: FeeBand[]; policy: UnknownDistrictPolicy; tenantCity: string | null };
export const NO_BANDS: DeliveryContext = { bands: [], policy: "confirm", tenantCity: null };

/** Maquininha (cartão ou Pix na entrega) = o entregador volta com ela: cobra a taxa de retorno. */
export const needsReturnTrip = (paymentMethod: string) => paymentMethod === "card" || paymentMethod === "pix";

/** Faixa da distância, ou null se estiver fora de todas (fora da área de entrega). */
export function bandFor(bands: FeeBand[], distanceM: number): FeeBand | null {
  const ordenadas = [...bands].sort((a, b) => a.toM - b.toM);
  return ordenadas.find((b) => distanceM <= b.toM && (distanceM > b.fromM || (b.fromM === 0 && distanceM === 0))) ?? null;
}

/** "3,5" ou "3.5" km → metros. Vazio → null. */
export function parseKm(v: string): number | null | undefined {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return undefined; // inválido
  const m = Math.round(Number(t) * 1000);
  return m <= 200000 ? m : undefined;
}
/** Tabela de faixas digitada no painel: "até X km", frete e taxa de retorno. Cada faixa começa onde a anterior termina. */
export function parseBands(rows: Array<{ ateKm: string; frete: string; retorno: string }>): { ok: true; bands: FeeBand[] } | { ok: false; message: string } {
  const bands: FeeBand[] = [];
  let anterior = 0;
  for (const [i, r] of rows.entries()) {
    const n = i + 1;
    const toM = parseKm(r.ateKm);
    if (!toM) return { ok: false, message: `Faixa ${n}: informe até quantos km (ex.: 2 ou 2,5).` };
    if (toM <= anterior) return { ok: false, message: `Faixa ${n}: o km final precisa ser maior que o da faixa anterior.` };
    const fee = r.frete.trim() === "0" ? 0 : parseBrl(r.frete);
    const ret = r.retorno.trim() === "" || r.retorno.trim() === "0" ? 0 : parseBrl(r.retorno);
    if (fee === null || fee > 100_000) return { ok: false, message: `Faixa ${n}: frete inválido (ex.: 9,90).` };
    if (ret === null || ret > 100_000) return { ok: false, message: `Faixa ${n}: taxa de retorno inválida (ex.: 4,95).` };
    bands.push({ fromM: anterior, toM, feeCents: fee, returnFeeCents: ret });
    anterior = toM;
  }
  if (bands.length > 30) return { ok: false, message: "No máximo 30 faixas." };
  return { ok: true, bands };
}

/** Tabela da Pick'n'Go (nov/2026): de 2 em 2 km até 18 km, retorno = metade do frete. */
export const PICKNGO_BANDS: Array<{ ateKm: string; frete: string; retorno: string }> = Array.from({ length: 9 }, (_, i) => ({
  ateKm: String(2 * (i + 1)),
  frete: (9.9 + 2 * i).toFixed(2).replace(".", ","),
  retorno: (4.95 + i).toFixed(2).replace(".", ","),
}));

export const metersToKm = (m: number) => (m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export type DeliveryFee =
  | { ok: true; feeCents: number; returnFeeCents: number; pending: boolean; distanceM: number | null; district: string | null }
  | { ok: false; message: string; field?: string };

/**
 * Frete da entrega. Sem faixas: taxa do bairro (ou a padrão), como sempre foi.
 * Com faixas: o bairro vem do CEP (ViaCEP), a distância vem da tabela de bairros e o valor, da faixa.
 */
export function deliveryFee(
  clientDistrict: string,
  paymentMethod: string,
  s: Pick<OrderSettings, "deliveryFeeCents">,
  districts: District[],
  ctx: DeliveryContext,
  cep?: CepInfo,
): DeliveryFee {
  if (ctx.bands.length === 0) {
    const d = districts.find((x) => x.nameKey === districtKey(clientDistrict));
    if (d && !d.active) return { ok: false, message: "Ainda não entregamos neste bairro. Você pode escolher retirar no balcão." };
    return { ok: true, feeCents: d ? d.feeCents : s.deliveryFeeCents, returnFeeCents: 0, pending: false, distanceM: null, district: clientDistrict || null };
  }

  if (cep?.status === "not_found") return { ok: false, message: "CEP não encontrado. Confira o número.", field: "address.zip" };
  const pendente = (district: string | null): DeliveryFee =>
    ctx.policy === "block"
      ? { ok: false, message: "Ainda não entregamos neste endereço. Você pode escolher retirar no balcão." }
      : { ok: true, feeCents: 0, returnFeeCents: 0, pending: true, distanceM: null, district };

  if (!cep || cep.status === "unavailable") return { ok: true, feeCents: 0, returnFeeCents: 0, pending: true, distanceM: null, district: clientDistrict || null };
  if (ctx.tenantCity && districtKey(cep.city) !== districtKey(ctx.tenantCity)) {
    return { ok: false, message: `Ainda não entregamos em ${cep.city}. Você pode escolher retirar no balcão.`, field: "address.zip" };
  }
  const bairro = cep.district || clientDistrict;
  const d = districts.find((x) => x.nameKey === districtKey(bairro));
  if (d && !d.active) return { ok: false, message: "Ainda não entregamos neste bairro. Você pode escolher retirar no balcão." };
  if (!d || d.distanceM == null) return pendente(bairro || null);
  const faixa = bandFor(ctx.bands, d.distanceM);
  if (!faixa) return { ok: false, message: "Este endereço fica fora da nossa área de entrega. Você pode escolher retirar no balcão." };
  return {
    ok: true,
    feeCents: faixa.feeCents,
    returnFeeCents: needsReturnTrip(paymentMethod) ? faixa.returnFeeCents : 0,
    pending: false,
    distanceM: d.distanceM,
    district: bairro,
  };
}

export type OrderLine = { menuItemId: string; name: string; unitPriceCents: number; quantity: number; notes: string | null; lineTotalCents: number };
export type OrderQuote =
  | {
      ok: true;
      lines: OrderLine[];
      subtotalCents: number;
      deliveryFeeCents: number;
      returnFeeCents: number;
      feePending: boolean;
      distanceM: number | null;
      district: string | null; // bairro usado no frete (o do CEP, quando há faixas)
      totalCents: number;
    }
  | { ok: false; message: string; field?: string };

export function quoteOrder(
  c: Checkout,
  s: OrderSettings,
  menu: MenuSnapshot,
  districts: District[],
  ctx: DeliveryContext = NO_BANDS,
  cep?: CepInfo,
): OrderQuote {
  if (!s.ordersEnabled) return { ok: false, message: "Este restaurante ainda não está recebendo pedidos pelo site." };
  if (!s.isOpen) return { ok: false, message: "O restaurante está fechado agora." };
  if (c.type === "delivery" && !s.deliveryEnabled) return { ok: false, message: "Este restaurante não está fazendo entregas." };
  if (c.type === "pickup" && !s.pickupEnabled) return { ok: false, message: "Este restaurante não está aceitando retirada." };

  const porId = new Map(menu.map((m) => [m.id, m]));
  const lines: OrderLine[] = [];
  for (const i of c.items) {
    const m = porId.get(i.id);
    if (!m || !m.categoryActive) return { ok: false, message: "Um item do carrinho não está mais no cardápio. Revise o carrinho." };
    if (!m.available) return { ok: false, message: `"${m.name}" está indisponível no momento. Retire do carrinho para continuar.` };
    const unit = effectivePrice(m);
    lines.push({ menuItemId: m.id, name: m.name, unitPriceCents: unit, quantity: i.quantity, notes: i.notes, lineTotalCents: unit * i.quantity });
  }
  const subtotalCents = lines.reduce((t, l) => t + l.lineTotalCents, 0);
  if (subtotalCents < s.minOrderCents) {
    return { ok: false, message: `O pedido mínimo é de ${(s.minOrderCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` };
  }

  if (c.type === "pickup") {
    return { ok: true, lines, subtotalCents, deliveryFeeCents: 0, returnFeeCents: 0, feePending: false, distanceM: null, district: null, totalCents: subtotalCents };
  }
  const f = deliveryFee(c.address?.district ?? "", c.paymentMethod, s, districts, ctx, cep);
  if (!f.ok) return { ok: false, message: f.message, field: f.field };
  return {
    ok: true,
    lines,
    subtotalCents,
    deliveryFeeCents: f.feeCents,
    returnFeeCents: f.returnFeeCents,
    feePending: f.pending,
    distanceM: f.distanceM,
    district: f.district,
    totalCents: subtotalCents + f.feeCents + f.returnFeeCents,
  };
}

/** "Troco para quanto?" — só faz sentido em dinheiro e se for maior que o total. */
export function parseChangeFor(valor: string, totalCents: number): { ok: true; cents: number | null } | { ok: false; message: string } {
  const v = valor.replace(/R\$|\s/g, "");
  if (v === "") return { ok: true, cents: null };
  const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, message: "Valor do troco inválido." };
  const cents = Math.round(n * 100);
  if (cents < totalCents) return { ok: false, message: "O valor para troco precisa ser maior que o total do pedido." };
  return { ok: true, cents };
}
