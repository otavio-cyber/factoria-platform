/**
 * Envio de mensagens pelo bot de avisos da Factoria (Telegram). Só no servidor.
 * O token fica em TELEGRAM_BOT_TOKEN e nunca aparece em erro ou log (vai na URL da API).
 * Só saída: o sistema chama o Telegram; o Telegram não chama o sistema.
 */
import "server-only";

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

export class TelegramError extends Error {}

type Resposta = { ok: boolean; description?: string };

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError("Telegram não configurado no servidor.");
  let r: Response;
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new TelegramError("Não foi possível falar com o Telegram.");
  }
  const data = (await r.json().catch(() => ({ ok: false }))) as Resposta;
  if (!r.ok || !data.ok) {
    // A descrição do Telegram não contém o token (ex.: "Bad Request: chat not found").
    throw new TelegramError(`Telegram HTTP ${r.status}: ${String(data.description ?? "erro").slice(0, 120)}`);
  }
}
