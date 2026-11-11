/** Frete por distância no banco real: faixas isoladas por restaurante, pedido com retorno e bairro pendente. */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { createCategoryOn, createItemOn } from "@/lib/db/menu";
import {
  createOrderOn,
  getDeliverySettingsOn,
  importDistrictDistancesOn,
  loadCheckoutContextOn,
  replaceFeeBandsOn,
  updateDeliverySettingsOn,
} from "@/lib/db/orders";
import { contacts, deliveryDistricts, deliveryFeeBands, menuCategories, menuItems, orderItems, orders, tenants } from "@/lib/db/schema";
import { itemSchema } from "@/lib/menu/rules";
import { checkoutSchema, parseBands, PICKNGO_BANDS, quoteOrder, type CepInfo } from "@/lib/orders/rules";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";
let item = "";
const pick = parseBands(PICKNGO_BANDS);
if (!pick.ok) throw new Error("faixas");
const todoDia = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["00:00", "23:59"]]]));
const cep = (district: string): CepInfo => ({ status: "ok", street: "Rua X", district, city: "Ribeirão Preto", state: "SP" });
const pedido = (district: string, paymentMethod = "card") =>
  checkoutSchema.parse({
    items: [{ id: item, quantity: 2 }], type: "delivery", name: "Ana Souza", phone: "(16) 99999-1234", paymentMethod,
    address: { zip: "14020-240", street: "Av. A", number: "1", complement: "", district, city: "Ribeirão Preto", state: "SP", reference: "" },
  });

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  const rows = await owner
    .insert(tenants)
    .values([
      { slug: `fr-a-${run}`, name: "Brasa A", ordersEnabled: true, openingHours: todoDia, addressCity: "Ribeirão Preto", addressState: "SP" },
      { slug: `fr-b-${run}`, name: "Brasa B" },
    ])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
  const cat = await createCategoryOn(app, A, { name: "Pratos", description: null, active: true });
  item = await createItemOn(app, A, itemSchema.parse({ categoryId: cat, name: "Churras Mista", description: "", price: "43,00", promoPrice: "", serves: "" }));
  await replaceFeeBandsOn(app, A, pick.bands);
  await importDistrictDistancesOn(app, A, [
    { name: "Ribeirânia", distanceM: 5200, active: true },
    { name: "Bonfim Paulista", distanceM: null, active: false },
  ]);
});

afterAll(async () => {
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(orderItems);
      await tx.delete(orders);
      await tx.delete(contacts);
      await tx.delete(deliveryDistricts);
      await tx.delete(deliveryFeeBands);
      await tx.delete(menuItems);
      await tx.delete(menuCategories);
    });
  }
  await owner.delete(tenants).where(inArray(tenants.id, [A, B]));
  await Promise.all(closers.map((c) => c()));
});

describe("configuração", () => {
  it("o checkout recebe faixas, regra do bairro sem distância e a cidade do restaurante", async () => {
    const ctx = await loadCheckoutContextOn(app, A);
    expect(ctx.delivery.bands).toHaveLength(9);
    expect(ctx.delivery).toMatchObject({ policy: "confirm", tenantCity: "Ribeirão Preto" });
    expect(ctx.districts.find((d) => d.distanceM === 5200)).toBeTruthy();
  });

  it("faixas e bairros de um restaurante não aparecem para outro", async () => {
    const b = await getDeliverySettingsOn(app, B);
    expect(b.bands).toHaveLength(0);
    expect(b.districts).toHaveLength(0);
  });

  it("a regra do bairro sem distância é salva; o banco recusa valor desconhecido e faixa invertida", async () => {
    const atual = (await getDeliverySettingsOn(app, A)).settings;
    await updateDeliverySettingsOn(app, A, { ...atual, unknownDistrictPolicy: "block" });
    expect((await getDeliverySettingsOn(app, A)).settings.unknownDistrictPolicy).toBe("block");
    await updateDeliverySettingsOn(app, A, { ...atual, unknownDistrictPolicy: "confirm" });
    await expect(withTenantOn(app, A, (tx) => tx.update(tenants).set({ unknownDistrictPolicy: "talvez" }))).rejects.toThrow();
    await expect(withTenantOn(app, A, (tx) => tx.insert(deliveryFeeBands).values({ tenantId: A, fromM: 5000, toM: 1000, feeCents: 1 }))).rejects.toThrow();
  });

  it("importar de novo atualiza a distância em vez de duplicar o bairro", async () => {
    await importDistrictDistancesOn(app, A, [{ name: "ribeirania", distanceM: 5300, active: true }]);
    const d = (await getDeliverySettingsOn(app, A)).districts.filter((x) => x.nameKey === "ribeirania");
    expect(d).toHaveLength(1);
    expect(d[0].distanceM).toBe(5300);
    await importDistrictDistancesOn(app, A, [{ name: "Ribeirânia", distanceM: 5200, active: true }]);
  });
});

describe("pedido", () => {
  it("grava frete, taxa de retorno e distância; total confere no banco", async () => {
    const ctx = await loadCheckoutContextOn(app, A);
    const q = quoteOrder(pedido("Ribeirânia"), ctx.settings, ctx.menu, ctx.districts, ctx.delivery, cep("Ribeirânia"));
    if (!q.ok) throw new Error(q.message);
    const r = await createOrderOn(app, A, pedido("Ribeirânia"), q, null);
    const [o] = await withTenantOn(app, A, (tx) => tx.select().from(orders).where(inArray(orders.publicToken, [r.token])));
    expect(o).toMatchObject({ deliveryFeeCents: 1390, returnFeeCents: 695, feePending: false, deliveryDistanceM: 5200, totalCents: 8600 + 1390 + 695 });
  });

  it("bairro sem distância: pedido com frete a confirmar e o bairro entra na lista para medir", async () => {
    const ctx = await loadCheckoutContextOn(app, A);
    const q = quoteOrder(pedido("Lagoinha"), ctx.settings, ctx.menu, ctx.districts, ctx.delivery, cep("Lagoinha"));
    if (!q.ok || !q.feePending) throw new Error("esperava frete a confirmar");
    const r = await createOrderOn(app, A, pedido("Lagoinha"), q, null, q.district);
    const [o] = await withTenantOn(app, A, (tx) => tx.select().from(orders).where(inArray(orders.publicToken, [r.token])));
    expect(o).toMatchObject({ feePending: true, deliveryFeeCents: 0, returnFeeCents: 0, totalCents: 8600 });
    const d = (await getDeliverySettingsOn(app, A)).districts.find((x) => x.nameKey === "lagoinha");
    expect(d).toMatchObject({ name: "Lagoinha", distanceM: null, active: true });
  });

  it("o banco recusa total que não soma frete + retorno", async () => {
    await expect(
      withTenantOn(app, A, (tx) =>
        tx.insert(orders).values({
          tenantId: A, number: 999, publicToken: `x-${run}`, type: "pickup", customerName: "X", customerPhone: "+5516999990000",
          paymentMethod: "card", subtotalCents: 1000, deliveryFeeCents: 0, returnFeeCents: 500, totalCents: 1000,
        }),
      ),
    ).rejects.toThrow();
  });
});
