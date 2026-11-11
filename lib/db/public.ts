/**
 * Leituras PÚBLICAS (sem login): a vitrine do cardápio.
 * Devolvem só o que um cliente do restaurante pode ver. Restaurante suspenso/cancelado → null.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { DeliveryContext, UnknownDistrictPolicy } from "@/lib/orders/rules";
import type { OpeningHours } from "@/lib/tenants/profile";
import { resolveTenantOn, withTenantOn, type Db } from "./core";
import { deliveryDistricts, deliveryFeeBands, menuCategories, menuItems, tenants } from "./schema";

export type PublicItem = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  promoPriceCents: number | null;
  serves: number | null;
  imageKey: string | null;
  featured: boolean;
  available: boolean;
};
export type PublicMenu = {
  tenantId: string;
  slug: string;
  name: string;
  category: string | null;
  phone: string | null;
  timezone: string;
  openingHours: OpeningHours;
  logoKey: string | null;
  coverKey: string | null;
  legalName: string | null;
  cnpj: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  ordering: {
    enabled: boolean;
    delivery: boolean;
    pickup: boolean;
    minOrderCents: number;
    deliveryFeeCents: number;
    prepTime: string | null;
  };
  categories: Array<{ id: string; name: string; description: string | null; items: PublicItem[] }>;
};

/** Taxas por bairro (públicas: o cliente vê a taxa antes de pedir). */
export function listPublicDistrictsOn(db: Db, tenantId: string) {
  return withTenantOn(db, tenantId, async (tx) => {
    const districts = await tx
      .select({
        name: deliveryDistricts.name,
        nameKey: deliveryDistricts.nameKey,
        feeCents: deliveryDistricts.feeCents,
        active: deliveryDistricts.active,
        distanceM: deliveryDistricts.distanceM,
      })
      .from(deliveryDistricts);
    const bands = await tx
      .select({ fromM: deliveryFeeBands.fromM, toM: deliveryFeeBands.toM, feeCents: deliveryFeeBands.feeCents, returnFeeCents: deliveryFeeBands.returnFeeCents })
      .from(deliveryFeeBands)
      .orderBy(asc(deliveryFeeBands.toM));
    const [t] = await tx.select({ policy: tenants.unknownDistrictPolicy, city: tenants.addressCity, state: tenants.addressState }).from(tenants);
    return {
      districts,
      delivery: { bands, policy: t.policy as UnknownDistrictPolicy, tenantCity: t.city } satisfies DeliveryContext,
      tenantState: t.state,
    };
  });
}

/** Slug do restaurante ativo dono deste domínio (null se nenhum). */
export async function resolveDomainOn(db: Db, host: string): Promise<string | null> {
  const rows = await db.execute<{ slug: string | null }>(sql`select factoria_resolve_domain(${host}) as slug`);
  return rows[0]?.slug ?? null;
}

export async function getPublicMenuOn(db: Db, slug: string): Promise<PublicMenu | null> {
  const t = await resolveTenantOn(db, slug);
  if (!t || t.status !== "active") return null;
  return withTenantOn(db, t.id, async (tx) => {
    const [r] = await tx.select().from(tenants).where(eq(tenants.id, t.id));
    const cats = await tx
      .select({ id: menuCategories.id, name: menuCategories.name, description: menuCategories.description })
      .from(menuCategories)
      .where(eq(menuCategories.active, true))
      .orderBy(asc(menuCategories.position), asc(menuCategories.createdAt));
    const items = await tx
      .select({
        id: menuItems.id,
        categoryId: menuItems.categoryId,
        name: menuItems.name,
        description: menuItems.description,
        priceCents: menuItems.priceCents,
        promoPriceCents: menuItems.promoPriceCents,
        serves: menuItems.serves,
        imageKey: menuItems.imageKey,
        featured: menuItems.featured,
        available: menuItems.available,
      })
      .from(menuItems)
      .orderBy(asc(menuItems.position), asc(menuItems.createdAt));
    return {
      tenantId: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      phone: r.phone,
      timezone: r.timezone,
      openingHours: r.openingHours as OpeningHours,
      logoKey: r.logoKey,
      coverKey: r.coverKey,
      legalName: r.legalName,
      cnpj: r.cnpj,
      address: {
        street: r.addressStreet,
        number: r.addressNumber,
        complement: r.addressComplement,
        district: r.addressDistrict,
        city: r.addressCity,
        state: r.addressState,
        zip: r.addressZip,
      },
      ordering: {
        enabled: r.ordersEnabled,
        delivery: r.deliveryEnabled,
        pickup: r.pickupEnabled,
        minOrderCents: r.minOrderCents,
        deliveryFeeCents: r.deliveryFeeCents,
        prepTime: r.prepTime,
      },
      categories: cats
        .map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id).map(({ categoryId: _c, ...i }) => i) }))
        .filter((c) => c.items.length > 0),
    };
  });
}
