/**
 * Ligação das fotos aos registros (item do cardápio, logo e capa do restaurante).
 * Cada função devolve a chave ANTERIOR, para o arquivo antigo ser apagado do armazenamento.
 */
import { eq, sql } from "drizzle-orm";
import { withTenantOn, type Db } from "./core";
import { MenuError } from "./menu";
import { menuItems, tenants } from "./schema";

export function setItemImageOn(db: Db, tenantId: string, itemId: string, key: string | null): Promise<string | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [atual] = await tx.select({ key: menuItems.imageKey }).from(menuItems).where(eq(menuItems.id, itemId)).for("update");
    if (!atual) throw new MenuError("Item não encontrado.");
    await tx.update(menuItems).set({ imageKey: key, updatedAt: sql`now()` }).where(eq(menuItems.id, itemId));
    return atual.key;
  });
}

export function setTenantImageOn(db: Db, tenantId: string, kind: "logo" | "capa", key: string | null): Promise<string | null> {
  return withTenantOn(db, tenantId, async (tx) => {
    const [atual] = await tx.select({ logo: tenants.logoKey, capa: tenants.coverKey }).from(tenants).where(eq(tenants.id, tenantId));
    if (!atual) throw new MenuError("Restaurante não encontrado.");
    await tx
      .update(tenants)
      .set(kind === "logo" ? { logoKey: key } : { coverKey: key })
      .where(eq(tenants.id, tenantId));
    return kind === "logo" ? atual.logo : atual.capa;
  });
}
