/** Importação de cardápio contra Postgres real: tudo ou nada, só em cardápio vazio, no restaurante certo. */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { importMenuOn, itemNameKey, listMenuOn } from "@/lib/db/menu";
import { setItemImageOn } from "@/lib/db/media";
import { menuCategories, menuItems, tenants } from "@/lib/db/schema";
import { parseMenuImport, type MenuImport } from "@/lib/menu/import";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
let A = "";
let B = "";

function menu(raw: unknown): MenuImport {
  const r = parseMenuImport(raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.menu;
}

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  const rows = await owner
    .insert(tenants)
    .values([{ slug: `imp-a-${run}`, name: "Imp A" }, { slug: `imp-b-${run}`, name: "Imp B" }])
    .returning({ id: tenants.id });
  [A, B] = rows.map((r) => r.id);
});

afterAll(async () => {
  for (const t of [A, B]) {
    await withTenantOn(owner, t, async (tx) => {
      await tx.delete(menuItems);
      await tx.delete(menuCategories);
    });
  }
  await owner.delete(tenants).where(inArray(tenants.id, [A, B]));
  await Promise.all(closers.map((c) => c()));
});

describe("importMenuOn", () => {
  it("cria categorias e itens na ordem do arquivo, só no restaurante indicado", async () => {
    const r = await importMenuOn(
      app,
      A,
      menu({
        categories: [
          { name: "Pratos", items: [{ name: "Churras", price: "39,90", promoPrice: "31,90", featured: true }, { name: "Família", price: "199,99" }] },
          { name: "Bebidas", items: [{ name: "Refri", price: "7,00", serves: 1 }] },
        ],
      }),
    );
    expect(r).toMatchObject({ categories: 2, items: 3, removed: { categories: 0, items: 0 } });
    const m = await listMenuOn(app, A);
    expect(m.map((c) => [c.name, c.items.map((i) => i.name)])).toEqual([
      ["Pratos", ["Churras", "Família"]],
      ["Bebidas", ["Refri"]],
    ]);
    expect(m[0].items[0]).toMatchObject({ priceCents: 3990, promoPriceCents: 3190, featured: true });
    expect(await listMenuOn(app, B)).toEqual([]);
  });

  it("recusa importar em cardápio que já tem categorias", async () => {
    await expect(importMenuOn(app, A, menu({ categories: [{ name: "Outra", items: [] }] }))).rejects.toThrow(/já tem categorias/);
    expect((await listMenuOn(app, A)).map((c) => c.name)).toEqual(["Pratos", "Bebidas"]);
  });

  it("é tudo ou nada: um erro no banco desfaz a importação inteira", async () => {
    const bad = menu({ categories: [{ name: "Ok", items: [{ name: "Item", price: "10,00" }] }, { name: "Quebra", items: [] }] });
    // força um erro de banco na 2ª categoria (nome acima do limite da coluna/regra do banco)
    (bad[1] as { name: string }).name = "x".repeat(5000);
    await expect(importMenuOn(app, B, bad)).rejects.toThrow();
    expect(await listMenuOn(app, B)).toEqual([]);
  });

  it("substituir: apaga o cardápio atual, grava o novo e reaproveita a foto de item com o mesmo nome", async () => {
    const key = (n: string) => `t/${A}/item/${n.repeat(32)}.webp`;
    const [pratos] = await listMenuOn(app, A);
    const [churras, familia] = pratos.items;
    await setItemImageOn(app, A, churras.id, key("a"));
    await setItemImageOn(app, A, familia.id, key("b"));

    const r = await importMenuOn(
      app,
      A,
      menu({ categories: [{ name: "Novos", items: [{ name: "  churras ", price: "35,00" }, { name: "Bebida", price: "5,00" }] }] }),
      { replace: true },
    );
    expect(r).toMatchObject({ categories: 1, items: 2, removed: { categories: 2, items: 3 }, photosKept: 1, orphanPhotos: [key("b")] });
    const m = await listMenuOn(app, A);
    expect(m.map((c) => c.name)).toEqual(["Novos"]);
    expect(m[0].items.map((i) => [i.name, i.imageKey])).toEqual([["churras", key("a")], ["Bebida", null]]);
    expect(await listMenuOn(app, B)).toEqual([]);
  });

  it("foto enviada na importação vale para o item e substitui a antiga de mesmo nome", async () => {
    const key = (n: string) => `t/${A}/item/${n.repeat(32)}.jpg`;
    const novo = menu({ categories: [{ name: "Fotos", items: [{ name: "Churras", price: "35,00" }, { name: "Suco", price: "8,00" }] }] });
    novo[0].items[0].imageKey = key("c");
    const r = await importMenuOn(app, A, novo, { replace: true });
    const m = await listMenuOn(app, A);
    expect(m[0].items.map((i) => [i.name, i.imageKey])).toEqual([["Churras", key("c")], ["Suco", null]]);
    expect(r.orphanPhotos).toEqual([`t/${A}/item/${"a".repeat(32)}.webp`]); // a antiga do Churras fica sem uso
  });

  it("recusa foto de outro restaurante (e não grava nada)", async () => {
    const outro = menu({ categories: [{ name: "X", items: [{ name: "Y", price: "1,00" }] }] });
    outro[0].items[0].imageKey = `t/${B}/item/${"d".repeat(32)}.jpg`;
    await expect(importMenuOn(app, A, outro, { replace: true })).rejects.toThrow(/outro restaurante/);
    expect((await listMenuOn(app, A)).map((c) => c.name)).toEqual(["Fotos"]);
  });
});

describe("itemNameKey", () => {
  it("ignora acento, maiúsculas, espaços e grafias de gramas", () => {
    expect(itemNameKey("Camarão Empanado 200grs")).toBe(itemNameKey("camarao  empanado 200 g"));
    expect(itemNameKey("Picanha 200 gr")).toBe("picanha 200g");
    expect(itemNameKey("Picanha")).not.toBe(itemNameKey("Picanha 200 g"));
  });
});
