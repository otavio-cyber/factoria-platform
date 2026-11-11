/**
 * Consulta de CEP no ViaCEP pelo servidor. O bairro que vale para o frete é o daqui,
 * nunca o que o navegador mandou (o cliente poderia trocar o bairro para pagar menos).
 * Só o CEP sai do sistema. Cache em memória para não repetir consultas.
 */
import "server-only";
import type { CepInfo } from "@/lib/orders/rules";

const CACHE = new Map<string, { at: number; info: CepInfo }>();
const TTL = 24 * 60 * 60_000;
const MAX = 2000;

type ViaCep = { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string };

export async function lookupCep(cep: string): Promise<CepInfo> {
  if (!/^[0-9]{8}$/.test(cep)) return { status: "not_found" };
  const c = CACHE.get(cep);
  if (c && Date.now() - c.at < TTL) return c.info;
  let info: CepInfo;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (r.status === 400) info = { status: "not_found" };
    else if (!r.ok) return { status: "unavailable" }; // instabilidade: não guarda no cache
    else {
      const d = (await r.json()) as ViaCep;
      info =
        d.erro || !d.localidade || !d.uf
          ? { status: "not_found" }
          : { status: "ok", street: d.logradouro || null, district: d.bairro || null, city: d.localidade, state: d.uf };
    }
  } catch {
    return { status: "unavailable" };
  }
  if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(cep, { at: Date.now(), info });
  return info;
}
