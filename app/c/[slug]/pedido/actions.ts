"use server";

import { headers } from "next/headers";
import { lookupCep } from "@/lib/cep/viacep";
import { getPublicMenu, ordersDbApi } from "@/lib/db";
import { allow } from "@/lib/orders/rate-limit";
import { checkoutSchema, parseChangeFor, quoteOrder } from "@/lib/orders/rules";
import { alertNewOrder } from "@/lib/telegram/notify";
import { notifyOrder } from "@/lib/whatsapp/notify";

export type CriarPedidoResult = { ok: true; token: string; number: number } | { ok: false; message: string; field?: string };

/**
 * Cria o pedido. Entrada não confiável: o servidor confere restaurante, horário,
 * disponibilidade, preços, taxa e mínimo pelo banco, e limita envios por IP.
 */
export async function criarPedido(slug: string, input: unknown): Promise<CriarPedidoResult> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(`pedido:${ip}:${slug}`, 5, 10 * 60_000)) {
    return { ok: false, message: "Muitos pedidos seguidos. Aguarde alguns minutos ou ligue para o restaurante." };
  }

  const m = await getPublicMenu(slug.toLowerCase());
  if (!m) return { ok: false, message: "Restaurante não encontrado." };

  const p = checkoutSchema.safeParse(input);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, message: i?.message ?? "Confira os dados do pedido.", field: i?.path.join(".") };
  }

  try {
    const ctx = await ordersDbApi.checkoutContext(m.tenantId);
    // Frete por distância: o bairro vale pelo CEP consultado aqui no servidor, não pelo que veio do navegador.
    const porDistancia = p.data.type === "delivery" && ctx.delivery.bands.length > 0;
    const cep = porDistancia && p.data.address ? await lookupCep(p.data.address.zip) : undefined;
    const q = quoteOrder(p.data, ctx.settings, ctx.menu, ctx.districts, ctx.delivery, cep);
    if (!q.ok) return { ok: false, message: q.message, field: q.field };
    if (cep?.status === "ok" && p.data.address) {
      const a = p.data.address;
      p.data.address = { ...a, district: cep.district ?? a.district, city: cep.city, state: cep.state, street: a.street ?? cep.street };
    }
    let troco: number | null = null;
    if (p.data.paymentMethod === "cash") {
      const t = parseChangeFor(p.data.changeFor, q.totalCents);
      if (!t.ok) return { ok: false, message: t.message, field: "changeFor" };
      troco = t.cents;
    }
    const pendente = porDistancia && q.feePending && cep?.status === "ok" ? q.district : null;
    const r = await ordersDbApi.create(m.tenantId, p.data, q, troco, pendente);
    notifyOrder(m.tenantId, { token: r.token }); // "recebemos seu pedido" (se o restaurante ligou os avisos)
    alertNewOrder(m.tenantId, r.token); // pedido novo no grupo da equipe no Telegram (se configurado)
    return { ok: true, token: r.token, number: r.number };
  } catch (err) {
    console.error("[pedido] falha ao criar", err);
    return { ok: false, message: "Não foi possível enviar o pedido agora. Tente de novo em instantes." };
  }
}
