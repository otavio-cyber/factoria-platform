/**
 * Avisos de pedido novo para a equipe (Telegram): configuração e dados do aviso.
 * Tudo por withTenantOn: o RLS garante que um restaurante só vê e altera a própria configuração.
 */
import { asc, eq, sql } from "drizzle-orm";
import { withTenantOn, type Db } from "./core";
import { orderAlerts, orderItems, orders, tenants } from "./schema";

export type OrderAlertSettings = { telegramChatId: string | null; enabled: boolean };

export function getOrderAlertsOn(db: Db, tenantId: string): Promise<OrderAlertSettings> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [c] = await tx.select({ telegramChatId: orderAlerts.telegramChatId, enabled: orderAlerts.enabled }).from(orderAlerts);
    return c ?? { telegramChatId: null, enabled: false };
  });
}

/** Grava o chat e se os avisos estão ligados. Sem chat, os avisos ficam desligados. */
export function setOrderAlertsOn(db: Db, tenantId: string, s: OrderAlertSettings) {
  const valores = { telegramChatId: s.telegramChatId, enabled: s.enabled && s.telegramChatId !== null };
  return withTenantOn(db, tenantId, async (tx) => {
    await tx
      .insert(orderAlerts)
      .values({ tenantId, ...valores })
      .onConflictDoUpdate({ target: orderAlerts.tenantId, set: { ...valores, updatedAt: sql`now()` } });
  });
}

export type OrderAlertData = {
  chatId: string;
  slug: string;
  order: typeof orders.$inferSelect & { restaurantName: string };
  items: Array<{ name: string; quantity: number; notes: string | null; lineTotalCents: number }>;
};

/** Dados do aviso do pedido — só se os avisos estão ligados e há um chat configurado. */
export function orderAlertOn(db: Db, tenantId: string, publicToken: string): Promise<OrderAlertData | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [cfg] = await tx.select().from(orderAlerts);
    if (!cfg?.enabled || !cfg.telegramChatId) return null;
    const [o] = await tx.select().from(orders).where(eq(orders.publicToken, publicToken));
    if (!o) return null;
    const items = await tx
      .select({ name: orderItems.name, quantity: orderItems.quantity, notes: orderItems.notes, lineTotalCents: orderItems.lineTotalCents })
      .from(orderItems)
      .where(eq(orderItems.orderId, o.id))
      .orderBy(asc(orderItems.id));
    const [t] = await tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants);
    return { chatId: cfg.telegramChatId, slug: t.slug, order: { ...o, restaurantName: t.name }, items };
  });
}
