/**
 * Entrega pública das fotos (cardápio, logo, capa). O bucket é privado: só o app lê.
 * Chave aleatória e imutável → cache de 1 ano no navegador e na Cloudflare.
 */
import { isValidKey, MIME_BY_EXT, type ImageType } from "@/lib/media/keys";
import { MediaNotConfigured, mediaStorage } from "@/lib/media/storage";

export async function GET(_req: Request, { params }: RouteContext<"/midia/[...key]">) {
  const key = (await params).key.join("/");
  if (!isValidKey(key)) return new Response("Não encontrado", { status: 404 });
  try {
    const body = await mediaStorage().get(key);
    if (!body) return new Response("Não encontrado", { status: 404 });
    const ext = key.slice(key.lastIndexOf(".") + 1) as ImageType["ext"];
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": MIME_BY_EXT[ext],
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    if (err instanceof MediaNotConfigured) return new Response("Não encontrado", { status: 404 });
    console.error("[midia]", err);
    return new Response("Indisponível", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
