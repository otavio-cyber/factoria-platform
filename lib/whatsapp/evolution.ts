/**
 * Cliente da Evolution API (WhatsApp provisório, não oficial). Só no servidor, só pela rede interna.
 * Sem configuração (dev/teste), `evolutionConfigured()` é false e nada é enviado.
 */
import "server-only";
import { instanceNameFor } from "./rules";

type Cfg = { url: string; key: string; webhookUrl: string; webhookSecret: string };

function cfg(): Cfg | null {
  const e = process.env;
  if (!e.EVOLUTION_URL || !e.EVOLUTION_API_KEY || !e.EVOLUTION_WEBHOOK_SECRET || !e.APP_INTERNAL_URL) return null;
  return {
    url: e.EVOLUTION_URL.replace(/\/$/, ""),
    key: e.EVOLUTION_API_KEY,
    webhookUrl: `${e.APP_INTERNAL_URL.replace(/\/$/, "")}/api/webhooks/evolution`,
    webhookSecret: e.EVOLUTION_WEBHOOK_SECRET,
  };
}

export const evolutionConfigured = () => cfg() !== null;

export class EvolutionError extends Error {}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const c = cfg();
  if (!c) throw new EvolutionError("WhatsApp não configurado no servidor.");
  const r = await fetch(`${c.url}${path}`, {
    method,
    headers: { apikey: c.key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await r.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  if (!r.ok) throw new EvolutionError(`Evolution ${method} ${path.split("/").slice(0, 3).join("/")}: HTTP ${r.status}`);
  return data;
}

type ConnectionState = { instance?: { state?: string } };
type QrResponse = { base64?: string; code?: string; instance?: { state?: string } };

/** Estado atual da instância do restaurante ("open" | "connecting" | "close"); sem instância → "close". */
export async function connectionState(tenantId: string): Promise<string> {
  try {
    const r = await call<ConnectionState>("GET", `/instance/connectionState/${instanceNameFor(tenantId)}`);
    return r.instance?.state ?? "close";
  } catch (e) {
    if (e instanceof EvolutionError && /HTTP 404/.test(e.message)) return "close";
    throw e;
  }
}

/** Cria a instância (se não existir) com o webhook interno protegido por cabeçalho secreto. */
async function ensureInstance(tenantId: string) {
  const c = cfg()!;
  const name = instanceNameFor(tenantId);
  const lista = await call<Array<{ name?: string }>>("GET", `/instance/fetchInstances?instanceName=${name}`).catch(() => []);
  if (Array.isArray(lista) && lista.some((i) => i.name === name)) return;
  await call("POST", "/instance/create", {
    instanceName: name,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    rejectCall: false,
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    syncFullHistory: false,
    webhook: {
      enabled: true,
      url: c.webhookUrl,
      byEvents: false,
      base64: false,
      headers: { "x-factoria-secret": c.webhookSecret },
      events: ["CONNECTION_UPDATE"],
    },
  });
}

/** Inicia (ou retoma) a conexão e devolve o QR code em imagem (data URL) para ler no celular. */
export async function startConnection(tenantId: string): Promise<{ state: string; qr: string | null }> {
  await ensureInstance(tenantId);
  const r = await call<QrResponse>("GET", `/instance/connect/${instanceNameFor(tenantId)}`);
  const state = r.instance?.state ?? (r.base64 ? "connecting" : "close");
  return { state, qr: r.base64 ?? null };
}

export async function logout(tenantId: string) {
  await call("DELETE", `/instance/logout/${instanceNameFor(tenantId)}`).catch((e) => {
    if (!(e instanceof EvolutionError && /HTTP (400|404)/.test(e.message))) throw e;
  });
}

/** Envia texto. `delay` simula digitação (comportamento mais humano, menor risco de bloqueio). */
export async function sendText(tenantId: string, number: string, text: string) {
  await call("POST", `/message/sendText/${instanceNameFor(tenantId)}`, { number, text, delay: 1200, linkPreview: false });
}

/** Número conectado na instância (ex.: "5516...") — para mostrar no painel. */
export async function connectedPhone(tenantId: string): Promise<string | null> {
  const name = instanceNameFor(tenantId);
  const lista = await call<Array<{ name?: string; ownerJid?: string | null }>>("GET", `/instance/fetchInstances?instanceName=${name}`).catch(
    () => [],
  );
  const jid = Array.isArray(lista) ? lista.find((i) => i.name === name)?.ownerJid : null;
  return jid ? jid.split("@")[0].replace(/\D/g, "") || null : null;
}
