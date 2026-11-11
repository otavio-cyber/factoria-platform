/** Fotos: formato reconhecido pelos bytes e chaves que não escapam do restaurante. */
import { describe, expect, it } from "vitest";
import { buildKey, isValidKey, keyBelongsTo, mediaUrl, sniffImage } from "@/lib/media/keys";

const T = "11111111-1111-4111-8111-111111111111";
const R = "0123456789abcdef0123456789abcdef";
const bytes = (...v: number[]) => new Uint8Array(v);
const txt = (s: string) => new TextEncoder().encode(s);

describe("sniffImage", () => {
  it("reconhece JPEG, PNG e WebP pelos bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe("jpg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.ext).toBe("png");
    expect(sniffImage(txt("RIFF\0\0\0\0WEBPVP8 "))?.ext).toBe("webp");
  });
  it("recusa SVG, HTML e PDF mesmo com nome de imagem", () => {
    expect(sniffImage(txt("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffImage(txt("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(txt("%PDF-1.7"))).toBeNull();
    expect(sniffImage(bytes())).toBeNull();
  });
});

describe("chaves", () => {
  it("monta e valida", () => {
    const k = buildKey(T, "item", "webp", R);
    expect(k).toBe(`t/${T}/item/${R}.webp`);
    expect(isValidKey(k)).toBe(true);
    expect(mediaUrl(k)).toBe(`/midia/${k}`);
    expect(mediaUrl(null)).toBeNull();
  });
  it("recusa caminhos maliciosos ou fora do padrão", () => {
    expect(isValidKey(`t/${T}/item/../../etc/passwd`)).toBe(false);
    expect(isValidKey(`t/${T}/item/${R}.svg`)).toBe(false);
    expect(isValidKey(`t/${T}/outro/${R}.webp`)).toBe(false);
    expect(isValidKey(`/t/${T}/item/${R}.webp`)).toBe(false);
  });
  it("chave de outro restaurante não pertence a este", () => {
    const outro = "22222222-2222-4222-8222-222222222222";
    expect(keyBelongsTo(buildKey(T, "logo", "png", R), T)).toBe(true);
    expect(keyBelongsTo(buildKey(outro, "logo", "png", R), T)).toBe(false);
  });
});
