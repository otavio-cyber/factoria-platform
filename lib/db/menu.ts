/**
 * Cardápio no banco — funções testáveis (recebem a conexão). Tudo passa por withTenantOn:
 * o RLS garante que um restaurante só lê e altera o próprio cardápio.
 * O app usa os atalhos exportados por `@/lib/db`.
 */
import { and, asc, count, eq, gt, lt, max, sql } from "drizzle-orm";
import { keyBelongsTo } from "@/lib/media/keys";
import type { MenuImport } from "@/lib/menu/import";
import type { CategoryData, ItemData } from "@/lib/menu/rules";
import { withTenantOn, type Db, type TenantTx } from "./core";
import { menuCategories, menuItems } from "./schema";

export type MenuCategory = typeof menuCategories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type MenuTree = Array<MenuCategory & { items: MenuItem[] }>;

export class MenuError extends Error {}

/** Cardápio completo do restaurante, já ordenado (categorias e itens por posição). */
export function listMenuOn(db: Db, tenantId: string): Promise<MenuTree> {
  return withTenantOn(db, tenantId, async (tx) => {
    const cats = await tx.select().from(menuCategories).orderBy(asc(menuCategories.position), asc(menuCategories.createdAt));
    const items = await tx.select().from(menuItems).orderBy(asc(menuItems.position), asc(menuItems.createdAt));
    return cats.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id) }));
  });
}

// ─── categorias ─────────────────────────────────────────────────────────────
export function createCategoryOn(db: Db, tenantId: string, input: CategoryData) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [{ m }] = await tx.select({ m: max(menuCategories.position) }).from(menuCategories);
    const [row] = await tx
      .insert(menuCategories)
      .values({ tenantId, ...input, position: (m ?? -1) + 1 })
      .returning({ id: menuCategories.id });
    return row.id;
  });
}

export function updateCategoryOn(db: Db, tenantId: string, id: string, input: CategoryData) {
  return withTenantOn(db, tenantId, async (tx) => {
    const r = await tx.update(menuCategories).set(input).where(eq(menuCategories.id, id)).returning({ id: menuCategories.id });
    if (r.length === 0) throw new MenuError("Categoria não encontrada.");
  });
}

export function deleteCategoryOn(db: Db, tenantId: string, id: string) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(menuItems).where(eq(menuItems.categoryId, id));
    if (n > 0) throw new MenuError("A categoria tem itens. Mova ou exclua os itens antes.");
    await tx.delete(menuCategories).where(eq(menuCategories.id, id));
  });
}

// ─── itens ──────────────────────────────────────────────────────────────────
function itemValues(d: ItemData) {
  return {
    categoryId: d.categoryId,
    name: d.name,
    description: d.description,
    priceCents: d.price,
    promoPriceCents: d.promoPrice,
    serves: d.serves,
    featured: d.featured,
    available: d.available,
  };
}

async function nextItemPosition(tx: TenantTx, categoryId: string) {
  const [{ m }] = await tx.select({ m: max(menuItems.position) }).from(menuItems).where(eq(menuItems.categoryId, categoryId));
  return (m ?? -1) + 1;
}

export function createItemOn(db: Db, tenantId: string, d: ItemData) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [row] = await tx
      .insert(menuItems)
      .values({ tenantId, ...itemValues(d), position: await nextItemPosition(tx, d.categoryId) })
      .returning({ id: menuItems.id });
    return row.id;
  });
}

export function updateItemOn(db: Db, tenantId: string, id: string, d: ItemData) {
  return withTenantOn(db, tenantId, async (tx) => {
    const [atual] = await tx.select({ categoryId: menuItems.categoryId }).from(menuItems).where(eq(menuItems.id, id));
    if (!atual) throw new MenuError("Item não encontrado.");
    // Mudou de categoria: vai para o fim da nova.
    const position = atual.categoryId !== d.categoryId ? { position: await nextItemPosition(tx, d.categoryId) } : {};
    await tx
      .update(menuItems)
      .set({ ...itemValues(d), ...position, updatedAt: sql`now()` })
      .where(eq(menuItems.id, id));
  });
}

/** Apaga o item. Devolve a chave da foto (se houver) para ser removida do armazenamento. */
export function deleteItemOn(db: Db, tenantId: string, id: string): Promise<string | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [r] = await tx.delete(menuItems).where(eq(menuItems.id, id)).returning({ key: menuItems.imageKey });
    return r?.key ?? null;
  });
}

/** Pausar / reativar (único ajuste que o atendente pode fazer). */
export function setItemAvailableOn(db: Db, tenantId: string, id: string, available: boolean) {
  return withTenantOn(db, tenantId, async (tx) => {
    const r = await tx
      .update(menuItems)
      .set({ available, updatedAt: sql`now()` })
      .where(eq(menuItems.id, id))
      .returning({ id: menuItems.id });
    if (r.length === 0) throw new MenuError("Item não encontrado.");
  });
}

// ─── importação ─────────────────────────────────────────────────────────────
/** Nome comparável: "Picanha  200g" e "picanha 200 g" são o mesmo item (para reaproveitar a foto). */
export const itemNameKey = (nome: string) =>
  nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/(\d)\s*(grs|gr|g)\b/g, "$1g") // 200grs, 200 gr, 200g → 200g
    .replace(/(\d)\s*(kg|ml|l)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();

export type ImportResult = {
  categories: number;
  items: number;
  removed: { categories: number; items: number };
  photosKept: number;
  /** Fotos de itens apagados que não tinham item correspondente: o arquivo fica sem uso no armazenamento. */
  orphanPhotos: string[];
};

/**
 * Cria o cardápio inteiro de uma vez (uma transação: ou entra tudo, ou nada).
 * Sem `replace`, só roda em cardápio VAZIO. Com `replace`, apaga o cardápio atual antes
 * (na mesma transação) e reaproveita a foto de item com o mesmo nome.
 * Pedidos já feitos não são afetados: guardam nome e preço do item no momento do pedido.
 */
export function importMenuOn(db: Db, tenantId: string, menu: MenuImport, opts: { replace?: boolean } = {}) {
  return withTenantOn(db, tenantId, async (tx): Promise<ImportResult> => {
    const atuais = await tx.select({ name: menuItems.name, imageKey: menuItems.imageKey }).from(menuItems);
    const [{ n }] = await tx.select({ n: count() }).from(menuCategories);
    if (n > 0 && !opts.replace) {
      throw new MenuError("O cardápio deste restaurante já tem categorias. Use a opção de substituir para trocar o cardápio inteiro.");
    }
    const fotos = new Map<string, string>();
    for (const a of atuais) if (a.imageKey && !fotos.has(itemNameKey(a.name))) fotos.set(itemNameKey(a.name), a.imageKey);
    if (opts.replace) {
      await tx.delete(menuItems);
      await tx.delete(menuCategories);
    }

    const usadas = new Set<string>();
    let items = 0;
    for (const [ci, { items: lista, ...cat }] of menu.entries()) {
      const [row] = await tx
        .insert(menuCategories)
        .values({ tenantId, ...cat, position: ci })
        .returning({ id: menuCategories.id });
      if (lista.length) {
        await tx.insert(menuItems).values(
          lista.map((item, ii) => {
            const { image, imageKey: nova, ...it } = item;
            void image; // a URL já virou imageKey no script
            // Foto enviada nesta importação (só deste restaurante) ou a do item de mesmo nome que já existia.
            if (nova && !keyBelongsTo(nova, tenantId)) throw new MenuError("Foto de outro restaurante na importação.");
            const foto = nova ? null : fotos.get(itemNameKey(it.name));
            const reaproveitada = foto && !usadas.has(foto) ? foto : null;
            if (reaproveitada) usadas.add(reaproveitada);
            return { tenantId, ...itemValues({ ...it, categoryId: row.id }), imageKey: nova ?? reaproveitada, position: ii };
          }),
        );
      }
      items += lista.length;
    }
    return {
      categories: menu.length,
      items,
      removed: { categories: opts.replace ? n : 0, items: opts.replace ? atuais.length : 0 },
      photosKept: usadas.size,
      orphanPhotos: [...new Set(atuais.map((a) => a.imageKey).filter((k): k is string => !!k && !usadas.has(k)))],
    };
  });
}

// ─── ordenação (troca com o vizinho) ────────────────────────────────────────
export function moveCategoryOn(db: Db, tenantId: string, id: string, dir: "up" | "down") {
  return withTenantOn(db, tenantId, async (tx) => {
    const [cur] = await tx.select().from(menuCategories).where(eq(menuCategories.id, id));
    if (!cur) throw new MenuError("Categoria não encontrada.");
    const [viz] = await tx
      .select()
      .from(menuCategories)
      .where(dir === "up" ? lt(menuCategories.position, cur.position) : gt(menuCategories.position, cur.position))
      .orderBy(dir === "up" ? sql`${menuCategories.position} desc` : asc(menuCategories.position))
      .limit(1);
    if (!viz) return;
    await tx.update(menuCategories).set({ position: viz.position }).where(eq(menuCategories.id, cur.id));
    await tx.update(menuCategories).set({ position: cur.position }).where(eq(menuCategories.id, viz.id));
  });
}

export function moveItemOn(db: Db, tenantId: string, id: string, dir: "up" | "down") {
  return withTenantOn(db, tenantId, async (tx) => {
    const [cur] = await tx.select().from(menuItems).where(eq(menuItems.id, id));
    if (!cur) throw new MenuError("Item não encontrado.");
    const [viz] = await tx
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.categoryId, cur.categoryId),
          dir === "up" ? lt(menuItems.position, cur.position) : gt(menuItems.position, cur.position),
        ),
      )
      .orderBy(dir === "up" ? sql`${menuItems.position} desc` : asc(menuItems.position))
      .limit(1);
    if (!viz) return;
    await tx.update(menuItems).set({ position: viz.position }).where(eq(menuItems.id, cur.id));
    await tx.update(menuItems).set({ position: cur.position }).where(eq(menuItems.id, viz.id));
  });
}
