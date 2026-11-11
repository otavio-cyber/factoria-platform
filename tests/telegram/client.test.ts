import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTelegram, telegramConfigured } from "@/lib/telegram/client";

const TOKEN = "123456:SEGREDO-do-bot";

describe("cliente do Telegram", () => {
  beforeEach(() => vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sem token, não está configurado e não envia", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect(telegramConfigured()).toBe(false);
    await expect(sendTelegram("-100123456", "oi")).rejects.toThrow("não configurado");
  });

  it("envia texto simples para o chat, sem prévia de link", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await sendTelegram("-100123456", "pedido");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body)).toEqual({ chat_id: "-100123456", text: "pedido", link_preview_options: { is_disabled: true } });
  });

  it("erro da API vira mensagem sem o token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }),
    ));
    const e = await sendTelegram("-100123456", "x").catch((err: Error) => err);
    expect(String(e)).toContain("chat not found");
    expect(String(e)).not.toContain(TOKEN);
  });

  it("falha de rede vira mensagem sem o token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/x`)));
    const e = await sendTelegram("-100123456", "x").catch((err: Error) => err);
    expect(String(e)).not.toContain(TOKEN);
  });
});
