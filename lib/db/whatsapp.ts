/**
 * Conexão de WhatsApp do restaurante e dados para os avisos de pedido.
 * Tudo por withTenantOn: o RLS garante que um restaurante só vê e altera a própria conexão.
 */
import { eq, sql } from "drizzle-orm";
import { instanceNameFor, type WhatsappStatus } from "@/lib/whatsapp/rules";
import { withTenantOn, type Db } from "./core";
import { orders, tenants, whatsappConnections } from "./schema";

export type WhatsappConnection = typeof whatsappConnections.$inferSelect;

export function getWhatsappOn(db: Db, tenantId: string): Promise<WhatsappConnection | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [c] = await tx.select().from(whatsappConnections);
    return c ?? null;
  });
}

/** Grava o estado da conexão (cria a linha na primeira vez). Desconectado apaga o número. */
export function setWhatsappStatusOn(db: Db, tenantId: string, status: WhatsappStatus, phone: string | null) {
  return withTenantOn(db, tenantId, async (tx) => {
    const numero = status === "connected" ? phone : null;
    await tx
      .insert(whatsappConnections)
      .values({ tenantId, instanceName: instanceNameFor(tenantId), status, phone: numero })
      .onConflictDoUpdate({
        target: whatsappConnections.tenantId,
        set: {
          status,
          // Evento de "conectado" sem número não apaga o número que já conhecemos.
          phone: status === "connected" ? sql`coalesce(${numero}, ${whatsappConnections.phone})` : null,
          updatedAt: sql`now()`,
        },
      });
  });
}

export function setNotifyOrdersOn(db: Db, tenantId: string, notify: boolean) {
  return withTenantOn(db, tenantId, async (tx) => {
    await tx
      .insert(whatsappConnections)
      .values({ tenantId, instanceName: instanceNameFor(tenantId), notifyOrders: notify })
      .onConflictDoUpdate({ target: whatsappConnections.tenantId, set: { notifyOrders: notify, updatedAt: sql`now()` } });
  });
}

export type OrderNotice = {
  status: string;
  type: string;
  number: number;
  customerName: string;
  customerPhone: string;
  cancelReason: string | null;
  publicToken: string;
  restaurantName: string;
  slug: string;
  customDomain: string | null;
};

/** O que o aviso do pedido precisa — só se o restaurante está conectado e com avisos ligados. */
export function orderNoticeOn(db: Db, tenantId: string, by: { id: string } | { token: string }): Promise<OrderNotice | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [c] = await tx.select().from(whatsappConnections);
    if (!c || c.status !== "connected" || !c.notifyOrders) return null;
    const [o] = await tx
      .select({
        status: orders.status,
        type: orders.type,
        number: orders.number,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        cancelReason: orders.cancelReason,
        publicToken: orders.publicToken,
      })
      .from(orders)
      .where("id" in by ? eq(orders.id, by.id) : eq(orders.publicToken, by.token));
    if (!o) return null;
    const [t] = await tx.select({ name: tenants.name, slug: tenants.slug, customDomain: tenants.customDomain }).from(tenants);
    return { ...o, restaurantName: t.name, slug: t.slug, customDomain: t.customDomain };
  });
}
