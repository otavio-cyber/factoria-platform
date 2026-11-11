/** Cliente S3 (Backblaze B2) sem rede: confere URL, método e assinatura das requisições. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { s3Storage } from "@/lib/media/storage";

const cfg = { endpoint: "https://s3.us-east-005.backblazeb2.com", region: "us-east-005", bucket: "meu-bucket", keyId: "id", secret: "segredo" };
const key = `t/11111111-1111-4111-8111-111111111111/item/${"a".repeat(32)}.webp`;

afterEach(() => vi.unstubAllGlobals());

function capturar(status = 200, body = "") {
  const reqs: Request[] = [];
  vi.stubGlobal("fetch", async (r: Request) => {
    reqs.push(r);
    return new Response(status === 204 ? null : body, { status });
  });
  return reqs;
}

describe("s3Storage", () => {
  it("PUT assinado no caminho do bucket, com tipo do arquivo", async () => {
    const reqs = capturar();
    await s3Storage(cfg).put(key, new Uint8Array([1, 2, 3]), "image/webp");
    expect(reqs[0].method).toBe("PUT");
    expect(reqs[0].url).toBe(`${cfg.endpoint}/meu-bucket/${key}`);
    expect(reqs[0].headers.get("content-type")).toBe("image/webp");
    expect(reqs[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/us-east-005\/s3\/aws4_request/);
  });
  it("GET 404 vira null; erro do servidor vira exceção", async () => {
    capturar(404);
    expect(await s3Storage(cfg).get(key)).toBeNull();
    capturar(500);
    await expect(s3Storage(cfg).get(key)).rejects.toThrow(/indisponível/);
  });
  it("DELETE aceita 204 e 404", async () => {
    capturar(204);
    await s3Storage(cfg).delete(key);
    capturar(404);
    await s3Storage(cfg).delete(key);
  });
});
