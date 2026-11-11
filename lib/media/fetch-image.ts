/**
 * Baixa uma foto por URL (importação de cardápio) com os mesmos limites do envio pelo painel:
 * só https, tempo máximo, tamanho máximo e formato conferido pelos bytes (JPEG, PNG ou WebP).
 * Sem "server-only": é usado pelo script de importação e pelos testes.
 */
import { MAX_BYTES, sniffImage, type ImageType } from "./keys";

export type FetchedImage = { ok: true; bytes: Uint8Array; type: ImageType } | { ok: false; reason: string };

export function isHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedImage> {
  if (!isHttpsUrl(url)) return { ok: false, reason: "URL precisa ser https" };
  let r: Response;
  try {
    r = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  } catch {
    return { ok: false, reason: "não foi possível baixar" };
  }
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false, reason: "foto maior que 1,5 MB" };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: "foto maior que 1,5 MB" };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, reason: "não é JPEG, PNG nem WebP" };
  return { ok: true, bytes, type };
}
