/** Conexão de WhatsApp no banco real: isolamento por restaurante e quando o aviso do pedido sai. */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { createCategoryOn, createItemOn } from "@/lib/db/menu";
import { createOrderOn, loadCheckoutContextOn } from "@/lib/db/orders";
import { contacts, menuCategories, menuItems, orderItems, orders, tenants, whatsappConnections } from "@/lib/db/schema";
import { getWhatsappOn, orderNoticeOn, setNotifyOrdersOn, setWhatsappStatusOn } from "@/lib/db/whatsapp";
import { itemSchema } from "@/lib/menu/rules";
import { checkoutSchema, quoteOrder } from "@/lib/orders/rules";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";
let token = "";

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
      { slug: `wa-a-${run}`, name: "Zap A", ordersEnabled: true, openingHours: todoDia },
      { slug: `wa-b-${run}`, name: "Zap B" },
    ])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
  const cat = await createCategoryOn(app, A, { name: "Pratos", description: null, active: true });
  const item = await createItemOn(app, A, itemSchema.parse({ categoryId: cat, name: "Churras", description: "", price: "30,00", promoPrice: "", serves: "" }));
  const c = checkoutSchema.parse({ items: [{ id: item, quantity: 1 }], type: "pickup", name: "Ana Souza", phone: "(16) 99999-1234", paymentMethod: "card" });
  const ctx = await loadCheckoutContextOn(app, A);
  const q = quoteOrder(c, ctx.settings, ctx.menu, ctx.districts);
  if (!q.ok) throw new Error(q.message);
  token = (await createOrderOn(app, A, c, q, null)).token;
});

afterAll(async () => {
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(whatsappConnections);
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

describe("conexão de WhatsApp", () => {
  it("grava status e número; cada restaurante vê só a própria conexão", async () => {
    await setWhatsappStatusOn(app, A, "connected", "5516999990000");
    const a = await getWhatsappOn(app, A);
    expect(a).toMatchObject({ status: "connected", phone: "5516999990000", instanceName: `factoria-${A}`, notifyOrders: false });
    expect(await getWhatsappOn(app, B)).toBeNull();
  });

  it("evento de conectado sem número mantém o número; desconectar apaga", async () => {
    await setWhatsappStatusOn(app, A, "connected", null);
    expect((await getWhatsappOn(app, A))?.phone).toBe("5516999990000");
    await setWhatsappStatusOn(app, A, "disconnected", null);
    expect(await getWhatsappOn(app, A)).toMatchObject({ status: "disconnected", phone: null });
  });

  it("o banco recusa status desconhecido", async () => {
    await expect(
      withTenantOn(app, A, (tx) => tx.update(whatsappConnections).set({ status: "banido" })),
    ).rejects.toThrow();
  });
});

describe("dados do aviso do pedido", () => {
  it("só sai com WhatsApp conectado E avisos ligados", async () => {
    await setWhatsappStatusOn(app, A, "connected", "5516999990000");
    expect(await orderNoticeOn(app, A, { token })).toBeNull(); // avisos desligados
    await setNotifyOrdersOn(app, A, true);
    const n = await orderNoticeOn(app, A, { token });
    expect(n).toMatchObject({ status: "received", customerName: "Ana Souza", customerPhone: "+5516999991234", restaurantName: "Zap A", slug: `wa-a-${run}` });
    await setWhatsappStatusOn(app, A, "disconnected", null);
    expect(await orderNoticeOn(app, A, { token })).toBeNull(); // desconectado
  });

  it("outro restaurante não acha o pedido nem com o token", async () => {
    await setWhatsappStatusOn(app, B, "connected", "5516988887777");
    await setNotifyOrdersOn(app, B, true);
    expect(await orderNoticeOn(app, B, { token })).toBeNull();
  });
});
