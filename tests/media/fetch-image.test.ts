import { describe, expect, it, vi } from "vitest";
import { fetchImage, isHttpsUrl } from "@/lib/media/fetch-image";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const resp = (body: Uint8Array | string, init: ResponseInit = {}) => vi.fn().mockResolvedValue(new Response(body as BodyInit, init));

describe("foto por URL na importação", () => {
  it("só aceita https sem usuário e senha", () => {
    expect(isHttpsUrl("https://static.ifood-static.com.br/image/upload/t_high/pratos/x/y.jpg")).toBe(true);
    for (const u of ["http://x.com/a.jpg", "javascript:alert(1)", "file:///etc/passwd", "https://u:p@x.com/a.jpg", "foto.jpg"]) {
      expect(isHttpsUrl(u)).toBe(false);
    }
  });

  it("baixa e identifica o formato pelos bytes", async () => {
    const r = await fetchImage("https://x.com/a.jpg", resp(JPEG, { status: 200 }));
    expect(r).toMatchObject({ ok: true, type: { ext: "jpg", mime: "image/jpeg" } });
  });

  it("recusa http, erro do servidor, arquivo grande e o que não é imagem", async () => {
    expect(await fetchImage("http://x.com/a.jpg", resp(JPEG))).toMatchObject({ ok: false });
    expect(await fetchImage("https://x.com/a.jpg", resp("", { status: 404 }))).toMatchObject({ ok: false, reason: "HTTP 404" });
    expect(await fetchImage("https://x.com/a.jpg", resp(JPEG, { headers: { "content-length": "9999999" } }))).toMatchObject({ ok: false });
    expect(await fetchImage("https://x.com/a.jpg", resp(new Uint8Array(1_600_000)))).toMatchObject({ ok: false });
    expect(await fetchImage("https://x.com/a.svg", resp("<svg onload=alert(1)>"))).toMatchObject({ ok: false });
  });

  it("falha de rede vira motivo, sem quebrar a importação", async () => {
    expect(await fetchImage("https://x.com/a.jpg", vi.fn().mockRejectedValue(new Error("x")))).toEqual({ ok: false, reason: "não foi possível baixar" });
  });
});
