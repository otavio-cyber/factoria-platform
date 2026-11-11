/**
 * Eventos da Evolution API (rede interna). Autenticação: cabeçalho secreto compartilhado,
 * comparado em tempo constante. Hoje só usamos mudança de conexão (conectado/desconectado).
 */
import { timingSafeEqual } from "node:crypto";
import { whatsappDbApi } from "@/lib/db";
import { parseEvolutionEvent } from "@/lib/whatsapp/rules";

function secretOk(recebido: string | null): boolean {
  const esperado = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretOk(request.headers.get("x-factoria-secret"))) return new Response("Não autorizado", { status: 401 });
  const body = await request.json().catch(() => null);
  const ev = parseEvolutionEvent(body);
  if (ev.kind === "connection") {
    try {
      await whatsappDbApi.setStatus(ev.tenantId, ev.status, ev.phone);
    } catch (err) {
      console.error("[whatsapp] webhook: falha ao gravar conexão", { tenantId: ev.tenantId, erro: String(err) });
      return new Response("Erro", { status: 500 }); // a Evolution tenta de novo
    }
  }
  return Response.json({ ok: true });
}
