"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/auth";
import { MenuError, ordersDbApi } from "@/lib/db";
import { parseBrl } from "@/lib/menu/rules";
import { districtKey, parseBands, parseKm } from "@/lib/orders/rules";

export type EntregaResult = { ok: true } | { ok: false; message: string };

const reais = (obrigatorio: boolean) =>
  z.string().transform((v, ctx) => {
    if (v.trim() === "") {
      if (obrigatorio) ctx.addIssue({ code: "custom", message: "Informe o valor (pode ser 0)." });
      return obrigatorio ? z.NEVER : 0;
    }
    const c = v.trim() === "0" ? 0 : parseBrl(v);
    if (c === null || c < 0 || c > 100_000_00) {
      ctx.addIssue({ code: "custom", message: "Valor inválido (ex.: 20,00)." });
      return z.NEVER;
    }
    return c;
  });

const settingsSchema = z
  .object({
    ordersEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    pickupEnabled: z.boolean(),
    minOrder: reais(false),
    deliveryFee: reais(true),
    prepTime: z.string().trim().max(40).transform((v) => (v === "" ? null : v)),
    unknownDistrictPolicy: z.enum(["confirm", "block"]).default("confirm"),
  })
  .refine((s) => !s.ordersEnabled || s.deliveryEnabled || s.pickupEnabled, "Para receber pedidos, ligue a entrega, a retirada ou as duas.");

const bairroSchema = z.object({
  name: z.string().trim().min(1, "Informe o bairro.").max(80),
  fee: reais(false),
  active: z.boolean(),
  distance: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined; // não mexe na distância
      const m = parseKm(v);
      if (m === undefined) {
        ctx.addIssue({ code: "custom", message: "Distância inválida (ex.: 3,5 km)." });
        return z.NEVER;
      }
      return m;
    }),
});

const faixasSchema = z.array(z.object({ ateKm: z.string().max(10), frete: z.string().max(12), retorno: z.string().max(12) })).max(30);

async function admin(slug: string) {
  const { tenant, role } = await requireTenantAccess(slug);
  return { tenant, bloqueado: role === "tenant_operator" };
}

async function executar(slug: string, fn: (t: string) => Promise<unknown>): Promise<EntregaResult> {
  const a = await admin(slug);
  if (a.bloqueado) return { ok: false, message: "Só o administrador do restaurante pode alterar a entrega." };
  try {
    await fn(a.tenant.id);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
    if (err instanceof MenuError) return { ok: false, message: err.message };
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return { ok: false, message: "Esse bairro já está na tabela." };
    console.error("[entrega]", err);
    return { ok: false, message: "Não foi possível salvar agora." };
  }
  revalidatePath(`/t/${a.tenant.slug}`, "layout");
  return { ok: true };
}

export async function salvarEntrega(slug: string, input: unknown): Promise<EntregaResult> {
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const s = p.data;
  return executar(slug, (t) =>
    ordersDbApi.updateDeliverySettings(t, {
      ordersEnabled: s.ordersEnabled,
      deliveryEnabled: s.deliveryEnabled,
      pickupEnabled: s.pickupEnabled,
      minOrderCents: s.minOrder,
      deliveryFeeCents: s.deliveryFee,
      prepTime: s.prepTime,
      unknownDistrictPolicy: s.unknownDistrictPolicy,
    }),
  );
}

export async function salvarFaixas(slug: string, input: unknown): Promise<EntregaResult> {
  const p = faixasSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Tabela de faixas inválida." };
  const b = parseBands(p.data);
  if (!b.ok) return b;
  return executar(slug, (t) => ordersDbApi.replaceFeeBands(t, b.bands));
}

export async function salvarBairro(slug: string, id: string | null, input: unknown): Promise<EntregaResult> {
  const p = bairroSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, message: "Bairro inválido." };
  return executar(slug, (t) =>
    ordersDbApi.upsertDistrict(t, {
      id,
      name: p.data.name,
      nameKey: districtKey(p.data.name),
      feeCents: p.data.fee,
      active: p.data.active,
      distanceM: p.data.distance,
    }),
  );
}

export async function excluirBairro(slug: string, id: string): Promise<EntregaResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Bairro inválido." };
  return executar(slug, (t) => ordersDbApi.deleteDistrict(t, id));
}
