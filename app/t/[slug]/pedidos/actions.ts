"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/auth";
import { MenuError, ordersDbApi } from "@/lib/db";
import { ORDER_STATUS, type OrderStatus } from "@/lib/orders/rules";
import { notifyOrder } from "@/lib/whatsapp/notify";

export type PedidoResult = { ok: true } | { ok: false; message: string };

async function rodar(slug: string, fn: (tenantId: string) => Promise<unknown>): Promise<PedidoResult> {
  const { tenant } = await requireTenantAccess(slug); // qualquer pessoa da equipe atende pedidos
  try {
    await fn(tenant.id);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    if (err instanceof MenuError) return { ok: false, message: err.message };
    console.error("[pedidos]", err);
    return { ok: false, message: "Não foi possível atualizar o pedido agora." };
  } finally {
    revalidatePath(`/t/${tenant.slug}/pedidos`);
  }
  return { ok: true };
}

const statusSchema = z.enum(Object.keys(ORDER_STATUS) as [OrderStatus, ...OrderStatus[]]);

export async function avancarPedido(slug: string, id: string, de: string) {
  const p = z.object({ id: z.uuid(), de: statusSchema }).safeParse({ id, de });
  if (!p.success) return { ok: false, message: "Pedido inválido." } satisfies PedidoResult;
  return rodar(slug, async (t) => {
    await ordersDbApi.advance(t, p.data.id, p.data.de);
    notifyOrder(t, { id: p.data.id });
  });
}

export async function cancelarPedido(slug: string, id: string, motivo: string) {
  const p = z.object({ id: z.uuid(), motivo: z.string().trim().max(200) }).safeParse({ id, motivo });
  if (!p.success) return { ok: false, message: "Pedido inválido." } satisfies PedidoResult;
  return rodar(slug, async (t) => {
    await ordersDbApi.cancel(t, p.data.id, p.data.motivo || null);
    notifyOrder(t, { id: p.data.id });
  });
}
