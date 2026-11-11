/**
 * Captura do link de ativação/redefinição de senha.
 *
 * Enquanto não há e-mail transacional, o link gerado pelo Better Auth é CAPTURADO
 * durante o onboarding e mostrado ao super admin, que o envia ao dono do restaurante.
 * Fora de uma captura (ex.: alguém chamando /request-password-reset direto), o link
 * NÃO é logado em produção — logar um link de senha seria vazar acesso.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const capture = new AsyncLocalStorage<{ url?: string }>();

export async function captureResetLink(fn: () => Promise<unknown>): Promise<string | null> {
  const box: { url?: string } = {};
  await capture.run(box, fn);
  return box.url ?? null;
}

export async function deliverResetLink({ email, url }: { email: string; url: string }): Promise<void> {
  const box = capture.getStore();
  if (box) {
    box.url = url;
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(`[dev] link de redefinição para ${email}: ${url}`);
    return;
  }
  // TODO(1.x e-mail transacional): enviar por e-mail. Até lá, não entrega nada.
  console.warn(`[auth] pedido de redefinição de senha para ${email} ignorado: e-mail transacional não configurado`);
}
