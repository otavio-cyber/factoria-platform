/**
 * Porta de entrada do banco para TODO o código do app.
 *
 *   import { withTenant } from "@/lib/db";
 *   const lista = await withTenant(tenantId, (tx) => tx.select().from(contacts));
 *
 * O único acesso sem tenant é `appDb()`, restrito pelo ESLint ao módulo de autenticação
 * (tabelas globais do Better Auth). Sem tenant definido, o RLS não devolve dados de negócio.
 * Conecta como factoria_app (DATABASE_URL) — usuário sem BYPASSRLS.
 */
import "server-only";
import { sql } from "drizzle-orm";
import type { OpeningHours, Profile } from "@/lib/tenants/profile";
import {
  getTenantRoleOn,
  listUserTenantsOn,
  makeDb,
  resolveTenantOn,
  withTenantOn,
  type Db,
  type TenantTx,
} from "./core";
import { tenants } from "./schema";
import * as menuDb from "./menu";
import * as mediaDb from "./media";
import * as publicDb from "./public";
import * as ordersDb from "./orders";
import * as whatsappDb from "./whatsapp";
import * as orderAlertsDb from "./order-alerts";

export * as schema from "./schema";
export type { TenantTx, ResolvedTenant, TenantRole, UserTenant } from "./core";

// Reaproveita a conexão entre reloads do `next dev` (evita esgotar o pool).
const globalForDb = globalThis as unknown as { __factoriaDb?: Db };

/** Conexão do app (factoria_app). Exportada só para o adaptador do Better Auth (tabelas globais). */
export function appDb(): Db {
  if (!globalForDb.__factoriaDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");
    globalForDb.__factoriaDb = makeDb(url).db;
  }
  return globalForDb.__factoriaDb;
}

export function withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return withTenantOn(appDb(), tenantId, fn);
}

export function resolveTenantBySlug(slug: string) {
  return resolveTenantOn(appDb(), slug);
}

export function listUserTenants(userId: string) {
  return listUserTenantsOn(appDb(), userId);
}

export function getTenantRole(tenantId: string, userId: string) {
  return getTenantRoleOn(appDb(), tenantId, userId);
}

export type TenantProfile = Profile & {
  slug: string;
  timezone: string;
  legalName: string | null;
  cnpj: string | null;
  logoKey: string | null;
  coverKey: string | null;
  customDomain: string | null;
};

/** Dados cadastrais do restaurante (RLS: só a linha do próprio tenant). */
export async function getTenantProfile(tenantId: string): Promise<TenantProfile> {
  const [t] = await withTenant(tenantId, (tx) => tx.select().from(tenants));
  if (!t) throw new Error("restaurante não encontrado");
  return {
    slug: t.slug,
    timezone: t.timezone,
    name: t.name,
    legalName: t.legalName,
    cnpj: t.cnpj,
    phone: t.phone,
    category: t.category as Profile["category"],
    addressZip: t.addressZip,
    addressStreet: t.addressStreet,
    addressNumber: t.addressNumber,
    addressComplement: t.addressComplement,
    addressDistrict: t.addressDistrict,
    addressCity: t.addressCity,
    addressState: t.addressState as Profile["addressState"],
    openingHours: t.openingHours as OpeningHours,
    logoKey: t.logoKey,
    coverKey: t.coverKey,
    customDomain: t.customDomain,
  };
}

/** Atualiza os dados operacionais (o app só tem UPDATE nessas colunas). */
export async function updateTenantProfile(tenantId: string, p: Profile): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(tenants)
      .set({
        name: p.name,
        category: p.category,
        phone: p.phone,
        addressZip: p.addressZip,
        addressStreet: p.addressStreet,
        addressNumber: p.addressNumber,
        addressComplement: p.addressComplement,
        addressDistrict: p.addressDistrict,
        addressCity: p.addressCity,
        addressState: p.addressState,
        openingHours: p.openingHours,
      })
      .where(sql`${tenants.id} = ${tenantId}`),
  );
}

// ─── cardápio (atalhos com a conexão do app) ────────────────────────────────
export { MenuError, type MenuCategory, type MenuItem, type MenuTree } from "./menu";
type SemDb<F> = F extends (db: Db, ...args: infer A) => infer R ? (...args: A) => R : never;
const bind = <F extends (db: Db, ...args: never[]) => unknown>(fn: F) =>
  ((...args: unknown[]) => (fn as unknown as (...a: unknown[]) => unknown)(appDb(), ...args)) as SemDb<F>;
export const menu = {
  list: bind(menuDb.listMenuOn),
  createCategory: bind(menuDb.createCategoryOn),
  updateCategory: bind(menuDb.updateCategoryOn),
  deleteCategory: bind(menuDb.deleteCategoryOn),
  moveCategory: bind(menuDb.moveCategoryOn),
  createItem: bind(menuDb.createItemOn),
  updateItem: bind(menuDb.updateItemOn),
  deleteItem: bind(menuDb.deleteItemOn),
  moveItem: bind(menuDb.moveItemOn),
  setItemAvailable: bind(menuDb.setItemAvailableOn),
  setItemImage: bind(mediaDb.setItemImageOn),
};

export const tenantImages = { set: bind(mediaDb.setTenantImageOn) };

// ─── vitrine pública (sem login) ────────────────────────────────────────────
export type { PublicMenu, PublicItem } from "./public";
export const getPublicMenu = bind(publicDb.getPublicMenuOn);
export const resolveDomain = bind(publicDb.resolveDomainOn);
export const listPublicDistricts = bind(publicDb.listPublicDistrictsOn);

// ─── pedidos ────────────────────────────────────────────────────────────────
export type { Order, OrderWithItems, DeliverySettings } from "./orders";
export const ordersDbApi = {
  checkoutContext: bind(ordersDb.loadCheckoutContextOn),
  create: bind(ordersDb.createOrderOn),
  byToken: bind(ordersDb.getOrderByTokenOn),
  list: bind(ordersDb.listOrdersOn),
  advance: bind(ordersDb.advanceOrderOn),
  cancel: bind(ordersDb.cancelOrderOn),
  deliverySettings: bind(ordersDb.getDeliverySettingsOn),
  updateDeliverySettings: bind(ordersDb.updateDeliverySettingsOn),
  upsertDistrict: bind(ordersDb.upsertDistrictOn),
  deleteDistrict: bind(ordersDb.deleteDistrictOn),
  replaceFeeBands: bind(ordersDb.replaceFeeBandsOn),
  importDistrictDistances: bind(ordersDb.importDistrictDistancesOn),
};

/** Saúde do banco para /api/health (só um SELECT 1, sem dados). */
export async function databaseHealthy(): Promise<boolean> {
  try {
    await appDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export const whatsappDbApi = {
  get: bind(whatsappDb.getWhatsappOn),
  setStatus: bind(whatsappDb.setWhatsappStatusOn),
  setNotifyOrders: bind(whatsappDb.setNotifyOrdersOn),
  orderNotice: bind(whatsappDb.orderNoticeOn),
};

export type { OrderAlertSettings, OrderAlertData } from "./order-alerts";
export const orderAlertsDbApi = {
  get: bind(orderAlertsDb.getOrderAlertsOn),
  set: bind(orderAlertsDb.setOrderAlertsOn),
  alert: bind(orderAlertsDb.orderAlertOn),
};
