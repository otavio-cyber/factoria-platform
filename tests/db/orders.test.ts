/** Pedidos no banco real: numeração, cliente na base, isolamento e proteções do histórico. */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { createCategoryOn, createItemOn } from "@/lib/db/menu";
import { advanceOrderOn, cancelOrderOn, createOrderOn, getOrderByTokenOn, listOrdersOn, loadCheckoutContextOn } from "@/lib/db/orders";
import { contacts, menuCategories, menuItems, orderItems, orders, tenants } from "@/lib/db/schema";
import { itemSchema } from "@/lib/menu/rules";
import { checkoutSchema, quoteOrder } from "@/lib/orders/rules";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";
let item = "";

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  const todoDia = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["00:00", "23:59"]]]));
  const rows = await owner
    .insert(tenants)
    .values([
      { slug: `ped-a-${run}`, name: "Pedidos A", ordersEnabled: true, deliveryFeeCents: 2000, minOrderCents: 1000, openingHours: todoDia },
      { slug: `ped-b-${run}`, name: "Pedidos B" },
    ])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
  const cat = await createCategoryOn(app, A, { name: "Carnes", description: null, active: true });
  item = await createItemOn(app, A, itemSchema.parse({ categoryId: cat, name: "Picanha", description: "", price: "34,99", promoPrice: "", serves: "" }));
});

afterAll(async () => {
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(orderItems);
      await tx.delete(orders);
      await tx.delete(contacts);
      await tx.delete(menuItems);
      await tx.delete(menuCategories);
    });
  }
  await owner.delete(tenants).where(inArray(tenants.id, [A, B]));
  await Promise.all(closers.map((c) => c()));
});

async function pedir(nome = "Maria", fone = "(16) 99999-0000") {
  const c = checkoutSchema.parse({ items: [{ id: item, quantity: 2 }], type: "pickup", name: nome, phone: fone, paymentMethod: "card" });
  const ctx = await loadCheckoutContextOn(app, A);
  const q = quoteOrder(c, ctx.settings, ctx.menu, ctx.districts);
  if (!q.ok) throw new Error(q.message);
  return createOrderOn(app, A, c, q, null);
}

describe("pedidos", () => {
  it("cria com número sequencial e guarda o cliente na base do restaurante", async () => {
    const p1 = await pedir();
    const p2 = await pedir("Maria Silva");
    expect(p2.number).toBe(p1.number + 1);
    const base = await withTenantOn(app, A, (tx) => tx.select().from(contacts).where(eq(contacts.phone, "+5516999990000")));
    expect(base).toHaveLength(1);
    expect(base[0].name).toBe("Maria Silva");
    const o = await getOrderByTokenOn(app, A, p1.token);
    expect(o).toMatchObject({ subtotalCents: 6998, totalCents: 6998, status: "received" });
    expect(o!.items[0]).toMatchObject({ name: "Picanha", quantity: 2, unitPriceCents: 3499 });
  });

  it("o link de acompanhamento não abre no contexto de outro restaurante", async () => {
    const p = await pedir();
    expect(await getOrderByTokenOn(app, B, p.token)).toBeNull();
    expect(await getOrderByTokenOn(app, A, "token-que-nao-existe-000")).toBeNull();
  });

  it("avança etapas; clique duplicado (etapa antiga) é recusado; cancelado não avança", async () => {
    const p = await pedir();
    const o = (await getOrderByTokenOn(app, A, p.token))!;
    expect(await advanceOrderOn(app, A, o.id, "received")).toBe("preparing");
    await expect(advanceOrderOn(app, A, o.id, "received")).rejects.toThrow(/outra pessoa/);
    await cancelOrderOn(app, A, o.id, "cliente desistiu");
    await expect(advanceOrderOn(app, A, o.id, "canceled")).rejects.toThrow(/finalizado/);
    expect((await listOrdersOn(app, A)).find((x) => x.id === o.id)?.cancelReason).toBe("cliente desistiu");
  });

  it("o app não apaga pedidos nem altera itens já vendidos", async () => {
    const p = await pedir();
    const o = (await getOrderByTokenOn(app, A, p.token))!;
    await expect(withTenantOn(app, A, (tx) => tx.delete(orders).where(eq(orders.id, o.id)))).rejects.toThrow();
    await expect(withTenantOn(app, A, (tx) => tx.update(orderItems).set({ quantity: 1 }).where(eq(orderItems.orderId, o.id)))).rejects.toThrow();
  });

  it("o banco recusa total que não fecha com subtotal + taxa", async () => {
    await expect(
      withTenantOn(app, A, (tx) =>
        tx.insert(orders).values({
          tenantId: A, number: 99999, publicToken: `x-${run}-aaaaaaaaaaaaaa`, type: "pickup", customerName: "X",
          customerPhone: "+5516999990000", paymentMethod: "card", subtotalCents: 1000, deliveryFeeCents: 0, totalCents: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("restaurante B não vê os pedidos de A", async () => {
    expect(await listOrdersOn(app, B)).toEqual([]);
  });
});
