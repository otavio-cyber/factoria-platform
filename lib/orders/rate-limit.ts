/**
 * Limite simples de envios por chave (ex.: IP + restaurante), em memória.
 * Suficiente para um servidor só; protege contra spam de pedidos falsos.
 */
const hits = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recentes = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recentes.length >= max) {
    hits.set(key, recentes);
    return false;
  }
  recentes.push(now);
  hits.set(key, recentes);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}
