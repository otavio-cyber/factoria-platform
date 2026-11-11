import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { resolveDomain } from "@/lib/db";
import { APP_HOSTS as APP_HOST_LIST } from "@/lib/tenants/app-hosts";
import { precisaLogin, rotaNoDominio } from "@/lib/tenants/routing";

/**
 * Porta de entrada de toda requisição.
 *
 * 1. Domínio próprio de restaurante (ex.: app.restaurante-exemplo.com.br):
 *    serve SÓ a vitrine do cardápio. Login, painel e API não existem ali (404),
 *    para que nenhuma sessão do sistema circule num domínio que não é da Factoria.
 * 2. Domínio do app (app.factoria.dev.br): checagem OTIMISTA de sessão nas áreas logadas.
 *    A verificação de verdade acontece em cada página (requireUser/requireTenantAccess).
 */
const APP_HOSTS = new Set(APP_HOST_LIST);

// Cache curto do domínio → restaurante (inclui "não existe"), para não ir ao banco a cada arquivo.
const cache = new Map<string, { slug: string | null; ate: number }>();
async function slugDoDominio(host: string): Promise<string | null> {
  const c = cache.get(host);
  if (c && c.ate > Date.now()) return c.slug;
  const slug = await resolveDomain(host).catch(() => null);
  if (cache.size > 500) cache.clear();
  cache.set(host, { slug, ate: Date.now() + 60_000 });
  return slug;
}

const naoEncontrado = () => new NextResponse("Não encontrado", { status: 404 });

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const { pathname } = request.nextUrl;

  if (!APP_HOSTS.has(host)) {
    const slug = await slugDoDominio(host);
    if (!slug) return naoEncontrado();
    const rota = rotaNoDominio(pathname);
    if (rota.tipo === "vitrine") return NextResponse.rewrite(new URL(`/c/${slug}${rota.caminho}`, request.url));
    if (rota.tipo === "liberar") return NextResponse.next();
    return naoEncontrado();
  }

  if (precisaLogin(pathname) && !getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Tudo, exceto os arquivos estáticos do build (precisam passar para a vitrine também).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
