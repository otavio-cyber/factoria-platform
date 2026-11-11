/** Avisos de pedido no Telegram, no banco real: isolamento por restaurante e quando o aviso sai. */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { createCategoryOn, createItemOn } from "@/lib/db/menu";
import { getOrderAlertsOn, orderAlertOn, setOrderAlertsOn } from "@/lib/db/order-alerts";
import { createOrderOn, loadCheckoutContextOn } from "@/lib/db/orders";
import { contacts, menuCategories, menuItems, orderAlerts, orderItems, orders, tenants } from "@/lib/db/schema";
import { itemSchema } from "@/lib/menu/rules";
import { checkoutSchema, quoteOrder } from "@/lib/orders/rules";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";
let token = "";
const GRUPO = "-1001234567890";

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
      { slug: `tg-a-${run}`, name: "Brasa A", ordersEnabled: true, openingHours: todoDia },
      { slug: `tg-b-${run}`, name: "Brasa B" },
    ])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
  const cat = await createCategoryOn(app, A, { name: "Pratos", description: null, active: true });
  const i1 = await createItemOn(app, A, itemSchema.parse({ categoryId: cat, name: "Churras", description: "", price: "30,00", promoPrice: "", serves: "" }));
  const i2 = await createItemOn(app, A, itemSchema.parse({ categoryId: cat, name: "Maionese", description: "", price: "9,90", promoPrice: "", serves: "" }));
  const c = checkoutSchema.parse({
    items: [{ id: i1, quantity: 2, notes: "bem passado" }, { id: i2, quantity: 1 }],
    type: "pickup", name: "Ana Souza", phone: "(16) 99999-1234", paymentMethod: "card",
  });
  const ctx = await loadCheckoutContextOn(app, A);
  const q = quoteOrder(c, ctx.settings, ctx.menu, ctx.districts);
  if (!q.ok) throw new Error(q.message);
  token = (await createOrderOn(app, A, c, q, null)).token;
});

afterAll(async () => {
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(orderAlerts);
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

describe("configuração dos avisos", () => {
  it("sem configuração: desligado e sem chat", async () => {
    expect(await getOrderAlertsOn(app, A)).toEqual({ telegramChatId: null, enabled: false });
  });

  it("grava o chat; cada restaurante vê só a própria configuração", async () => {
    await setOrderAlertsOn(app, A, { telegramChatId: GRUPO, enabled: true });
    expect(await getOrderAlertsOn(app, A)).toEqual({ telegramChatId: GRUPO, enabled: true });
    expect(await getOrderAlertsOn(app, B)).toEqual({ telegramChatId: null, enabled: false });
  });

  it("sem chat, os avisos ficam desligados mesmo se pedirem para ligar", async () => {
    await setOrderAlertsOn(app, B, { telegramChatId: null, enabled: true });
    expect(await getOrderAlertsOn(app, B)).toEqual({ telegramChatId: null, enabled: false });
  });

  it("o banco recusa ID de chat fora do formato", async () => {
    await expect(
      withTenantOn(app, A, (tx) => tx.update(orderAlerts).set({ telegramChatId: "@grupo" })),
    ).rejects.toThrow();
  });
});

describe("dados do aviso", () => {
  it("com avisos ligados: pedido, itens na ordem e chat de destino", async () => {
    await setOrderAlertsOn(app, A, { telegramChatId: GRUPO, enabled: true });
    const a = await orderAlertOn(app, A, token);
    expect(a?.chatId).toBe(GRUPO);
    expect(a?.order).toMatchObject({ customerName: "Ana Souza", type: "pickup", paymentMethod: "card", restaurantName: "Brasa A" });
    expect(a?.items).toHaveLength(2);
    expect(a?.items.find((i) => i.name === "Churras")).toMatchObject({ quantity: 2, notes: "bem passado", lineTotalCents: 6000 });
  });

  it("desligado: nada a enviar", async () => {
    await setOrderAlertsOn(app, A, { telegramChatId: GRUPO, enabled: false });
    expect(await orderAlertOn(app, A, token)).toBeNull();
  });

  it("outro restaurante não acha o pedido de A, mesmo com o token", async () => {
    await setOrderAlertsOn(app, A, { telegramChatId: GRUPO, enabled: true });
    await setOrderAlertsOn(app, B, { telegramChatId: "-1009999999999", enabled: true });
    expect(await orderAlertOn(app, B, token)).toBeNull();
  });
});
