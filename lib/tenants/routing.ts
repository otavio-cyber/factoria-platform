/**
 * Regras de roteamento por domínio (puras, testadas). Usadas pelo proxy.ts.
 */
const PROTEGIDAS = /^\/(?:$|t\/|admin(?:\/|$))/;
const LIBERADAS_NO_DOMINIO = /^\/(?:_next\/|midia\/|favicon\.ico$)/;

/** No domínio do app: a rota exige estar logado? (checagem otimista; a real é em cada página) */
export const precisaLogin = (pathname: string) => PROTEGIDAS.test(pathname);

/**
 * No domínio de um restaurante: só a vitrine (na raiz) e os arquivos que ela usa.
 * Login, painel, API e qualquer outra rota não existem ali.
 */
export function rotaNoDominio(pathname: string): { tipo: "vitrine"; caminho: string } | { tipo: "liberar" } | { tipo: "nao-encontrado" } {
  if (pathname === "/") return { tipo: "vitrine", caminho: "" };
  if (pathname === "/pedido") return { tipo: "vitrine", caminho: "/pedido" };
  const acompanhar = /^\/p\/([A-Za-z0-9_-]{20,40})$/.exec(pathname);
  if (acompanhar) return { tipo: "vitrine", caminho: `/p/${acompanhar[1]}` };
  if (LIBERADAS_NO_DOMINIO.test(pathname)) return { tipo: "liberar" };
  return { tipo: "nao-encontrado" };
}

/** Prefixo dos links da vitrine: vazio no domínio do restaurante, /c/<slug> no domínio do app. */
export function vitrineBase(host: string | null, slug: string, appHosts: string[]): string {
  const h = (host ?? "").split(":")[0].toLowerCase();
  return appHosts.includes(h) ? `/c/${slug}` : "";
}
