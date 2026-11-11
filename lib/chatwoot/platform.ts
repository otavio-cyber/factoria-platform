/**
 * Cliente mínimo da Platform API do Chatwoot (conferido no código-fonte do Chatwoot v4.18.0).
 *
 *   POST /platform/api/v1/accounts                                 { name, locale }
 *   POST /platform/api/v1/users                                    { name, email, password }
 *   POST /platform/api/v1/accounts/:account_id/account_users       { user_id, role: agent|administrator }
 *   GET  /platform/api/v1/users/:id/login                          → { url }  (SSO, vale 5 min)
 *
 * Autenticação: header `api_access_token` com o token do Platform App (Super Admin → Platform Apps).
 * O token dá poder sobre TODAS as contas criadas por ele: fica só no .env do servidor.
 */
import { randomBytes } from "node:crypto";

export interface ChatwootPlatform {
  createAccount(input: { name: string }): Promise<{ id: number }>;
  createUser(input: { name: string; email: string }): Promise<{ id: number }>;
  addAccountUser(input: { accountId: number; userId: number; role: "agent" | "administrator" }): Promise<void>;
  ssoLoginUrl(userId: number): Promise<string>;
}

export class ChatwootError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** E-mail técnico do usuário no Chatwoot. `.invalid` é reservado (RFC 2606): nunca existe de verdade. */
export function chatwootEmailFor(userId: string): string {
  return `${userId.toLowerCase().replace(/[^a-z0-9]/g, "")}@chatwoot.factoria.invalid`;
}

/** Senha aleatória que atende às regras do Chatwoot (maiúscula, minúscula, número, símbolo). Ninguém a usa: o acesso é por SSO. */
function randomPassword(): string {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

export function httpChatwootPlatform(config: { baseUrl: string; token: string; timeoutMs?: number }): ChatwootPlatform {
  const base = config.baseUrl.replace(/\/+$/, "");

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/platform/api/v1${path}`, {
        method,
        headers: { "content-type": "application/json", api_access_token: config.token },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new ChatwootError(`Chatwoot inacessível (${(err as Error).name})`);
    }
    const text = await res.text();
    if (!res.ok) {
      // Nunca inclui o token na mensagem; corta o corpo para não vazar dados no log/painel.
      throw new ChatwootError(`Chatwoot respondeu ${res.status} em ${method} ${path}: ${text.slice(0, 200)}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    async createAccount({ name }) {
      const r = await call<{ id: number }>("POST", "/accounts", { name, locale: "pt_BR" });
      return { id: r.id };
    },
    async createUser({ name, email }) {
      const r = await call<{ id: number }>("POST", "/users", { name, email, password: randomPassword() });
      return { id: r.id };
    },
    async addAccountUser({ accountId, userId, role }) {
      await call("POST", `/accounts/${accountId}/account_users`, { user_id: userId, role });
    },
    async ssoLoginUrl(userId) {
      const r = await call<{ url: string }>("GET", `/users/${userId}/login`);
      if (!r.url) throw new ChatwootError("Chatwoot não devolveu o link de login");
      return r.url;
    },
  };
}

/** Cliente configurado pelo ambiente, ou null se a integração não estiver configurada. */
export function chatwootFromEnv(): ChatwootPlatform | null {
  const baseUrl = process.env.CHATWOOT_URL;
  const token = process.env.CHATWOOT_PLATFORM_TOKEN;
  if (!baseUrl || !token) return null;
  return httpChatwootPlatform({ baseUrl, token });
}
