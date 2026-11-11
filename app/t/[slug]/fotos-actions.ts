"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/lib/auth";
import { menu, MenuError, tenantImages } from "@/lib/db";
import { buildKey, MAX_BYTES, mediaUrl, sniffImage } from "@/lib/media/keys";
import { MediaNotConfigured, mediaStorage } from "@/lib/media/storage";

const alvoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("item"), id: z.uuid() }),
  z.object({ tipo: z.literal("logo") }),
  z.object({ tipo: z.literal("capa") }),
]);
export type FotoAlvo = z.infer<typeof alvoSchema>;
export type FotoResult = { ok: true; url: string | null } | { ok: false; message: string };

async function preparar(slug: string, alvoBruto: unknown) {
  const { tenant, role } = await requireTenantAccess(slug); // 404 sem acesso
  if (role === "tenant_operator") return { erro: "Só o administrador do restaurante pode trocar fotos." } as const;
  const alvo = alvoSchema.safeParse(alvoBruto);
  if (!alvo.success) return { erro: "Pedido inválido." } as const;
  return { tenant, alvo: alvo.data } as const;
}

/** Grava a chave no registro certo e devolve a anterior. */
function vincular(tenantId: string, alvo: FotoAlvo, key: string | null) {
  return alvo.tipo === "item" ? menu.setItemImage(tenantId, alvo.id, key) : tenantImages.set(tenantId, alvo.tipo, key);
}

function falha(err: unknown): FotoResult {
  if ((err as { digest?: string }).digest?.startsWith("NEXT_")) throw err;
  if (err instanceof MediaNotConfigured || err instanceof MenuError) return { ok: false, message: err.message };
  console.error("[fotos]", err);
  return { ok: false, message: "Não foi possível salvar a foto agora. Tente de novo." };
}

/**
 * Recebe a foto (já reduzida no navegador), confere que é mesmo uma imagem pelos bytes,
 * grava com nome aleatório e troca no registro. A foto antiga é apagada.
 */
export async function enviarFoto(slug: string, alvoBruto: unknown, form: FormData): Promise<FotoResult> {
  const p = await preparar(slug, alvoBruto);
  if ("erro" in p) return { ok: false, message: p.erro! };
  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, message: "Escolha uma foto." };
  if (arquivo.size > MAX_BYTES) return { ok: false, message: "Foto grande demais. Tente outra imagem." };
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = sniffImage(bytes);
  if (!tipo) return { ok: false, message: "Formato não aceito. Use uma foto JPG, PNG ou WebP." };

  const kind = p.alvo.tipo === "item" ? "item" : p.alvo.tipo;
  const key = buildKey(p.tenant.id, kind, tipo.ext, randomBytes(16).toString("hex"));
  try {
    const storage = mediaStorage();
    await storage.put(key, bytes, tipo.mime);
    let antiga: string | null;
    try {
      antiga = await vincular(p.tenant.id, p.alvo, key);
    } catch (err) {
      await storage.delete(key).catch(() => {}); // não deixa arquivo órfão
      throw err;
    }
    if (antiga && antiga !== key) await storage.delete(antiga).catch((e) => console.error("[fotos] apagar antiga", e));
  } catch (err) {
    return falha(err);
  }
  revalidatePath(`/t/${p.tenant.slug}`, "layout");
  return { ok: true, url: mediaUrl(key) };
}

export async function removerFoto(slug: string, alvoBruto: unknown): Promise<FotoResult> {
  const p = await preparar(slug, alvoBruto);
  if ("erro" in p) return { ok: false, message: p.erro! };
  try {
    const antiga = await vincular(p.tenant.id, p.alvo, null);
    if (antiga) await mediaStorage().delete(antiga).catch((e) => console.error("[fotos] apagar", e));
  } catch (err) {
    return falha(err);
  }
  revalidatePath(`/t/${p.tenant.slug}`, "layout");
  return { ok: true, url: null };
}
