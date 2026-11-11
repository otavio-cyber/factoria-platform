/**
 * Cardápio contra Postgres real: isolamento entre restaurantes (RLS + FK composta),
 * ordenação e proteção contra apagar categoria com itens.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import {
  createCategoryOn,
  createItemOn,
  deleteCategoryOn,
  listMenuOn,
  moveItemOn,
  setItemAvailableOn,
} from "@/lib/db/menu";
import { setItemImageOn, setTenantImageOn } from "@/lib/db/media";
import { menuCategories, menuItems, tenants } from "@/lib/db/schema";
import { itemSchema } from "@/lib/menu/rules";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";
let catA = "";
let catB = "";

const item = (categoryId: string, name: string, price = "10,00") =>
  itemSchema.parse({ categoryId, name, description: "", price, promoPrice: "", serves: "" });

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  const rows = await owner
    .insert(tenants)
    .values([{ slug: `menu-a-${run}`, name: "Menu A" }, { slug: `menu-b-${run}`, name: "Menu B" }])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
  catA = await createCategoryOn(app, A, { name: "Carnes", description: null, active: true });
  catB = await createCategoryOn(app, B, { name: "Bebidas", description: null, active: true });
  await createItemOn(app, A, item(catA, "Picanha"));
  await createItemOn(app, A, item(catA, "Alcatra"));
  await createItemOn(app, B, item(catB, "Refrigerante"));
});

afterAll(async () => {
  // RLS forçado vale até para o owner: limpa restaurante por restaurante.
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(menuItems);
      await tx.delete(menuCategories);
    });
  }
  await owner.delete(tenants).where(inArray(tenants.id, [A, B]));
  await Promise.all(closers.map((c) => c()));
});

describe("isolamento do cardápio", () => {
  it("cada restaurante vê só o próprio cardápio", async () => {
    const ma = await listMenuOn(app, A);
    expect(ma.map((c) => c.name)).toEqual(["Carnes"]);
    expect(ma[0].items.map((i) => i.name)).toEqual(["Picanha", "Alcatra"]);
    const mb = await listMenuOn(app, B);
    expect(mb.flatMap((c) => c.items.map((i) => i.name))).toEqual(["Refrigerante"]);
  });

  it("não cria item na categoria de outro restaurante", async () => {
    await expect(createItemOn(app, A, item(catB, "Invasor"))).rejects.toThrow();
  });

  it("não pausa item de outro restaurante", async () => {
    const [refri] = (await listMenuOn(app, B))[0].items;
    await expect(setItemAvailableOn(app, A, refri.id, false)).rejects.toThrow(/não encontrado/);
    expect((await listMenuOn(app, B))[0].items[0].available).toBe(true);
  });

  it("sem restaurante definido, o banco não devolve nada (fail-closed)", async () => {
    expect(await app.select().from(menuItems)).toEqual([]);
  });

  it("o banco recusa preço promocional maior que o normal", async () => {
    await expect(
      withTenantOn(app, A, (tx) =>
        tx.insert(menuItems).values({ tenantId: A, categoryId: catA, name: "X", priceCents: 1000, promoPriceCents: 1200 }),
      ),
    ).rejects.toThrow();
  });
});

describe("organização", () => {
  it("move o item dentro da categoria", async () => {
    const [, alcatra] = (await listMenuOn(app, A))[0].items;
    await moveItemOn(app, A, alcatra.id, "up");
    expect((await listMenuOn(app, A))[0].items.map((i) => i.name)).toEqual(["Alcatra", "Picanha"]);
  });

  it("não apaga categoria que ainda tem itens", async () => {
    await expect(deleteCategoryOn(app, A, catA)).rejects.toThrow(/tem itens/);
  });
});

describe("fotos", () => {
  const key = (t: string) => `t/${t}/item/${"a".repeat(32)}.webp`;

  it("liga a foto ao item e devolve a anterior (para apagar o arquivo)", async () => {
    const [picanha] = (await listMenuOn(app, A))[0].items;
    expect(await setItemImageOn(app, A, picanha.id, key(A))).toBeNull();
    expect(await setItemImageOn(app, A, picanha.id, null)).toBe(key(A));
  });

  it("não troca a foto do item de outro restaurante", async () => {
    const [refri] = (await listMenuOn(app, B))[0].items;
    await expect(setItemImageOn(app, A, refri.id, key(A))).rejects.toThrow(/não encontrado/);
  });

  it("logo e capa do restaurante", async () => {
    expect(await setTenantImageOn(app, A, "logo", key(A))).toBeNull();
    expect(await setTenantImageOn(app, A, "capa", key(A))).toBeNull();
    expect(await setTenantImageOn(app, A, "logo", null)).toBe(key(A));
  });
});
