/**
 * Pedidos no banco. Criação pública (sem login) passa por withTenantOn do restaurante resolvido
 * pelo slug; o RLS impede tocar em pedidos de outro restaurante.
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, notInArray, or, sql } from "drizzle-orm";
import { isOpenAt, type OpeningHours } from "@/lib/tenants/profile";
import {
  districtKey,
  nextStatus,
  type Checkout,
  type DeliveryContext,
  type District,
  type FeeBand,
  type MenuSnapshot,
  type OrderLine,
  type OrderSettings,
  type OrderStatus,
  type OrderType,
  type UnknownDistrictPolicy,
} from "@/lib/orders/rules";
import { withTenantOn, type Db } from "./core";
import { MenuError } from "./menu";
import { contacts, deliveryDistricts, deliveryFeeBands, menuCategories, menuItems, orderItems, orders, tenants } from "./schema";

export type Order = typeof orders.$inferSelect;
export type OrderWithItems = Order & { items: Array<typeof orderItems.$inferSelect> };
export type DeliverySettings = {
  ordersEnabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderCents: number;
  deliveryFeeCents: number;
  prepTime: string | null;
  unknownDistrictPolicy: UnknownDistrictPolicy;
};

/** Tudo que o checkout precisa para calcular o pedido no servidor. */
export function loadCheckoutContextOn(db: Db, tenantId: string, now = new Date()) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const menu: MenuSnapshot = await tx
      .select({
        id: menuItems.id,
        name: menuItems.name,
        priceCents: menuItems.priceCents,
        promoPriceCents: menuItems.promoPriceCents,
        available: menuItems.available,
        categoryActive: menuCategories.active,
      })
      .from(menuItems)
      .innerJoin(menuCategories, and(eq(menuCategories.tenantId, menuItems.tenantId), eq(menuCategories.id, menuItems.categoryId)));
    const districts: District[] = await tx
      .select({ nameKey: deliveryDistricts.nameKey, feeCents: deliveryDistricts.feeCents, active: deliveryDistricts.active, distanceM: deliveryDistricts.distanceM })
      .from(deliveryDistricts);
    const bands: FeeBand[] = await tx
      .select({ fromM: deliveryFeeBands.fromM, toM: deliveryFeeBands.toM, feeCents: deliveryFeeBands.feeCents, returnFeeCents: deliveryFeeBands.returnFeeCents })
      .from(deliveryFeeBands)
      .orderBy(asc(deliveryFeeBands.toM));
    const delivery: DeliveryContext = {
      bands,
      policy: t.unknownDistrictPolicy as UnknownDistrictPolicy,
      tenantCity: t.addressCity,
    };
    const settings: OrderSettings = {
      ordersEnabled: t.ordersEnabled,
      deliveryEnabled: t.deliveryEnabled,
      pickupEnabled: t.pickupEnabled,
      minOrderCents: t.minOrderCents,
      deliveryFeeCents: t.deliveryFeeCents,
      isOpen: isOpenAt(t.openingHours as OpeningHours, t.timezone, now),
    };
    return { settings, menu, districts, delivery };
  });
}

export function createOrderOn(
  db: Db,
  tenantId: string,
  c: Checkout,
  quote: {
    lines: OrderLine[];
    subtotalCents: number;
    deliveryFeeCents: number;
    returnFeeCents?: number;
    feePending?: boolean;
    distanceM?: number | null;
    totalCents: number;
  },
  changeForCents: number | null,
  /** Bairro do CEP sem distância cadastrada: entra na tabela para a equipe medir. */
  pendingDistrict: string | null = null,
): Promise<{ number: number; token: string }> {
  return withTenantOn(db, tenantId, async (tx) => {
    // Número sequencial por restaurante sem corrida entre dois pedidos simultâneos.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"orders:" + tenantId}))`);
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${orders.number}), 0) + 1` }).from(orders);

    // Cliente entra (ou é atualizado) na base do restaurante.
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, phone: c.phone, name: c.name, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.phone],
        set: { name: c.name, lastSeenAt: sql`now()` },
      })
      .returning({ id: contacts.id });

    const token = randomBytes(18).toString("base64url");
    const a = c.type === "delivery" ? c.address : undefined;
    const [o] = await tx
      .insert(orders)
      .values({
        tenantId,
        number: Number(n),
        publicToken: token,
        type: c.type,
        contactId: contato.id,
        customerName: c.name,
        customerPhone: c.phone,
        addressZip: a?.zip || null,
        addressStreet: a?.street ?? null,
        addressNumber: a?.number ?? null,
        addressComplement: a?.complement ?? null,
        addressDistrict: a?.district ?? null,
        addressCity: a?.city ?? null,
        addressState: a?.state ?? null,
        addressReference: a?.reference ?? null,
        notes: c.notes,
        paymentMethod: c.paymentMethod,
        changeForCents,
        subtotalCents: quote.subtotalCents,
        deliveryFeeCents: quote.deliveryFeeCents,
        returnFeeCents: quote.returnFeeCents ?? 0,
        feePending: quote.feePending ?? false,
        deliveryDistanceM: quote.distanceM ?? null,
        totalCents: quote.totalCents,
      })
      .returning({ id: orders.id, number: orders.number });
    if (pendingDistrict) {
      await tx
        .insert(deliveryDistricts)
        .values({ tenantId, name: pendingDistrict.slice(0, 80), nameKey: districtKey(pendingDistrict), distanceM: null })
        .onConflictDoNothing({ target: [deliveryDistricts.tenantId, deliveryDistricts.nameKey] });
    }
    await tx.insert(orderItems).values(quote.lines.map((l) => ({ tenantId, orderId: o.id, ...l })));
    return { number: o.number, token };
  });
}

export function getOrderByTokenOn(db: Db, tenantId: string, token: string): Promise<OrderWithItems | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return Promise.resolve(null);
  return withTenantOn(db, tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.publicToken, token));
    if (!o) return null;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.id));
    return { ...o, items };
  });
}

/** Painel: pedidos em andamento (qualquer data) + finalizados das últimas 24 h. */
export function listOrdersOn(db: Db, tenantId: string, now = new Date()): Promise<OrderWithItems[]> {
  return withTenantOn(db, tenantId, async (tx) => {
    const desde = new Date(now.getTime() - 24 * 3600 * 1000);
    const lista = await tx
      .select()
      .from(orders)
      .where(or(notInArray(orders.status, ["delivered", "canceled"]), gte(orders.createdAt, desde)))
      .orderBy(desc(orders.createdAt))
      .limit(200);
    if (lista.length === 0) return [];
    const itens = await tx.select().from(orderItems).where(inArray(orderItems.orderId, lista.map((o) => o.id)));
    return lista.map((o) => ({ ...o, items: itens.filter((i) => i.orderId === o.id) }));
  });
}

/** Avança uma etapa. `de` evita pular etapas quando duas pessoas clicam ao mesmo tempo. */
export function advanceOrderOn(db: Db, tenantId: string, id: string, de: OrderStatus) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [o] = await tx.select({ status: orders.status, type: orders.type }).from(orders).where(eq(orders.id, id)).for("update");
    if (!o) throw new MenuError("Pedido não encontrado.");
    if (o.status !== de) throw new MenuError("Este pedido já foi atualizado por outra pessoa. A lista foi recarregada.");
    const para = nextStatus(o.status as OrderStatus, o.type as OrderType);
    if (!para) throw new MenuError("Este pedido já foi finalizado.");
    await tx.update(orders).set({ status: para, statusChangedAt: sql`now()` }).where(eq(orders.id, id));
    return para;
  });
}

export function cancelOrderOn(db: Db, tenantId: string, id: string, reason: string | null) {
  return withTenantOn(db, tenantId, async (tx) => {
    const r = await tx
      .update(orders)
      .set({ status: "canceled", cancelReason: reason, statusChangedAt: sql`now()` })
      .where(and(eq(orders.id, id), notInArray(orders.status, ["delivered", "canceled"])))
      .returning({ id: orders.id });
    if (r.length === 0) throw new MenuError("Este pedido já foi finalizado ou cancelado.");
  });
}

// ─── configuração de entrega ────────────────────────────────────────────────
export function getDeliverySettingsOn(db: Db, tenantId: string) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [t] = await tx
      .select({
        ordersEnabled: tenants.ordersEnabled,
        deliveryEnabled: tenants.deliveryEnabled,
        pickupEnabled: tenants.pickupEnabled,
        minOrderCents: tenants.minOrderCents,
        deliveryFeeCents: tenants.deliveryFeeCents,
        prepTime: tenants.prepTime,
        unknownDistrictPolicy: tenants.unknownDistrictPolicy,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const districts = await tx.select().from(deliveryDistricts).orderBy(asc(deliveryDistricts.name));
    const bands = await tx.select().from(deliveryFeeBands).orderBy(asc(deliveryFeeBands.toM));
    return { settings: t as DeliverySettings, districts, bands };
  });
}

export function updateDeliverySettingsOn(db: Db, tenantId: string, s: DeliverySettings) {
  return withTenantOn(db, tenantId, (tx) => tx.update(tenants).set(s).where(eq(tenants.id, tenantId)));
}

export function upsertDistrictOn(
  db: Db,
  tenantId: string,
  d: { id: string | null; name: string; nameKey: string; feeCents: number; active: boolean; distanceM?: number | null },
) {
  return withTenantOn(db, tenantId, async (tx) => {
    const v = { name: d.name, nameKey: d.nameKey, feeCents: d.feeCents, active: d.active, ...(d.distanceM !== undefined ? { distanceM: d.distanceM } : {}) };
    if (d.id) {
      const r = await tx.update(deliveryDistricts).set(v).where(eq(deliveryDistricts.id, d.id)).returning({ id: deliveryDistricts.id });
      if (r.length === 0) throw new MenuError("Bairro não encontrado.");
    } else {
      await tx.insert(deliveryDistricts).values({ tenantId, ...v });
    }
  });
}

export function deleteDistrictOn(db: Db, tenantId: string, id: string) {
  return withTenantOn(db, tenantId, (tx) => tx.delete(deliveryDistricts).where(eq(deliveryDistricts.id, id)));
}

/** Troca a tabela de faixas inteira (o painel envia sempre a tabela completa). Lista vazia = volta ao frete por bairro. */
export function replaceFeeBandsOn(db: Db, tenantId: string, bands: FeeBand[]) {
  return withTenantOn(db, tenantId, async (tx) => {
    await tx.delete(deliveryFeeBands);
    if (bands.length) await tx.insert(deliveryFeeBands).values(bands.map((b) => ({ tenantId, ...b })));
  });
}

/** Distâncias em lote (importação da planilha): bairro novo entra; o que já existe tem a distância atualizada. */
export function importDistrictDistancesOn(db: Db, tenantId: string, rows: Array<{ name: string; distanceM: number | null; active: boolean }>) {
  return withTenantOn(db, tenantId, async (tx) => {
    for (const r of rows) {
      await tx
        .insert(deliveryDistricts)
        .values({ tenantId, name: r.name, nameKey: districtKey(r.name), distanceM: r.distanceM, active: r.active })
        .onConflictDoUpdate({
          target: [deliveryDistricts.tenantId, deliveryDistricts.nameKey],
          set: { distanceM: r.distanceM, active: r.active },
        });
    }
    return rows.length;
  });
}
