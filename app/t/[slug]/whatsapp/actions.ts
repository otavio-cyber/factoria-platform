"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth";
import { whatsappDbApi } from "@/lib/db";
import { connectedPhone, connectionState, evolutionConfigured, logout, startConnection } from "@/lib/whatsapp/evolution";
import { mapState, type WhatsappStatus } from "@/lib/whatsapp/rules";

export type WhatsappResult =
  | { ok: true; status: WhatsappStatus; qr?: string | null }
  | { ok: false; message: string };

/** Só o administrador (ou a Factoria) conecta, desconecta ou liga avisos. */
async function admin(slug: string) {
  const { tenant, role } = await requireTenantAccess(slug);
  if (role === "tenant_operator") return { tenant, erro: "Só o administrador do restaurante pode alterar o WhatsApp." };
  if (!evolutionConfigured()) return { tenant, erro: "O WhatsApp ainda não está configurado no servidor." };
  return { tenant, erro: null };
}

function falha(err: unknown): WhatsappResult {
  if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
  console.error("[whatsapp]", err instanceof Error ? err.message : err);
  return { ok: false, message: "Não foi possível falar com o WhatsApp agora. Tente de novo em instantes." };
}

/** Inicia a conexão e devolve o QR code para ler no celular do restaurante. */
export async function conectarWhatsapp(slug: string): Promise<WhatsappResult> {
  const { tenant, erro } = await admin(slug);
  if (erro) return { ok: false, message: erro };
  try {
    const r = await startConnection(tenant.id);
    const status = mapState(r.state);
    await whatsappDbApi.setStatus(tenant.id, status === "connected" ? "connected" : "connecting", null);
    return { ok: true, status, qr: r.qr };
  } catch (err) {
    return falha(err);
  }
}

/** Consulta o estado atual (usado enquanto o QR code está na tela). */
export async function estadoWhatsapp(slug: string): Promise<WhatsappResult> {
  const { tenant, erro } = await admin(slug);
  if (erro) return { ok: false, message: erro };
  try {
    const status = mapState(await connectionState(tenant.id));
    const atual = await whatsappDbApi.get(tenant.id);
    if (atual?.status !== status && status !== "connecting") {
      const fone = status === "connected" ? (atual?.phone ?? (await connectedPhone(tenant.id))) : null;
      await whatsappDbApi.setStatus(tenant.id, status, fone);
      revalidatePath(`/t/${tenant.slug}/whatsapp`);
    }
    return { ok: true, status };
  } catch (err) {
    return falha(err);
  }
}

export async function desconectarWhatsapp(slug: string): Promise<WhatsappResult> {
  const { tenant, erro } = await admin(slug);
  if (erro) return { ok: false, message: erro };
  try {
    await logout(tenant.id);
    await whatsappDbApi.setStatus(tenant.id, "disconnected", null);
    revalidatePath(`/t/${tenant.slug}/whatsapp`);
    return { ok: true, status: "disconnected" };
  } catch (err) {
    return falha(err);
  }
}

export async function avisosWhatsapp(slug: string, ligar: boolean): Promise<WhatsappResult> {
  const { tenant, role } = await requireTenantAccess(slug);
  if (role === "tenant_operator") return { ok: false, message: "Só o administrador do restaurante pode alterar o WhatsApp." };
  try {
    await whatsappDbApi.setNotifyOrders(tenant.id, ligar === true);
    revalidatePath(`/t/${tenant.slug}/whatsapp`);
    const c = await whatsappDbApi.get(tenant.id);
    return { ok: true, status: (c?.status as WhatsappStatus) ?? "disconnected" };
  } catch (err) {
    return falha(err);
  }
}
