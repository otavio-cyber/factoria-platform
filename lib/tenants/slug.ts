/**
 * Slug do tenant: identifica o restaurante na URL (/t/<slug>) e, no futuro,
 * em páginas públicas (<slug>.factoria.dev.br). Regras:
 *  - 2 a 40 caracteres, a-z, 0-9 e hífen, sem hífen nas pontas (mesmo CHECK do banco)
 *  - não pode ser um nome reservado (rotas do app, serviços, subdomínios já usados na zona DNS)
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

export const RESERVED_SLUGS = new Set([
  // app e infraestrutura
  "app", "www", "api", "admin", "auth", "login", "logout", "ativar", "t", "static", "assets", "cdn",
  "chat", "n8n", "mail", "email", "smtp", "status", "docs", "help", "ajuda", "suporte", "blog",
  "dev", "staging", "test", "teste", "sandbox", "factoria", "root", "system", "null", "undefined",
  // serviços de apoio
  "dash", "task", "portainer", "db", "monitor",
]);

/** Sugere um slug a partir do nome: "Casa Exemplo Grill" → "casa-exemplo-grill". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** null = válido; string = motivo (mensagem para o usuário). */
export function slugError(slug: string): string | null {
  if (!SLUG_RE.test(slug)) {
    return "Use de 2 a 40 caracteres: letras minúsculas, números e hífen (sem hífen no início ou no fim).";
  }
  if (RESERVED_SLUGS.has(slug)) return "Este endereço é reservado. Escolha outro.";
  return null;
}
