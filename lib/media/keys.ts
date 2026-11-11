/**
 * Regras puras das fotos: tipos aceitos (pelos bytes, não pelo nome do arquivo),
 * formato das chaves e URL pública. Sem dependência de servidor.
 */
export const MAX_BYTES = 1_500_000; // o navegador já reduz a foto antes de enviar
export type ImageKind = "item" | "logo" | "capa";
export type ImageType = { ext: "webp" | "jpg" | "png"; mime: "image/webp" | "image/jpeg" | "image/png" };

/** Identifica o formato pelos primeiros bytes. Qualquer outra coisa (SVG, HTML, PDF…) é recusada. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v))
    return { ext: "png", mime: "image/png" };
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

const KEY_RE = /^t\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(item|logo|capa)\/[0-9a-f]{32}\.(webp|jpg|png)$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** A chave pertence a este restaurante? (impede apontar para a foto de outro) */
export function keyBelongsTo(key: string, tenantId: string): boolean {
  return isValidKey(key) && key.startsWith(`t/${tenantId}/`);
}

/** Nome aleatório e imutável: trocar a foto gera outra chave (cache eterno sem risco). */
export function buildKey(tenantId: string, kind: ImageKind, ext: ImageType["ext"], random: string): string {
  return `t/${tenantId}/${kind}/${random}.${ext}`;
}

export const MIME_BY_EXT: Record<ImageType["ext"], ImageType["mime"]> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
};

export const mediaUrl = (key: string | null | undefined) => (key ? `/midia/${key}` : null);
