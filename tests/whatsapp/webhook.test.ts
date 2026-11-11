/** Rota de eventos da Evolution: sem o segredo certo, nada passa. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/evolution/route";

const SEGREDO = "segredo-de-teste-123";
const antes = process.env.EVOLUTION_WEBHOOK_SECRET;
beforeAll(() => {
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
});
afterAll(() => {
  process.env.EVOLUTION_WEBHOOK_SECRET = antes;
});

const req = (secret: string | null, body: unknown) =>
  new Request("http://factoria-app:3000/api/webhooks/evolution", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-factoria-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

describe("webhook da Evolution", () => {
  it("recusa sem segredo ou com segredo errado", async () => {
    expect((await POST(req(null, {}))).status).toBe(401);
    expect((await POST(req("errado", {}))).status).toBe(401);
    expect((await POST(req(SEGREDO + "x", {}))).status).toBe(401);
  });
  it("aceita com o segredo certo e ignora eventos que não usamos", async () => {
    const r = await POST(req(SEGREDO, { event: "messages.upsert", instance: "qualquer", data: {} }));
    expect(r.status).toBe(200);
  });
  it("sem segredo configurado no servidor, recusa tudo", async () => {
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect((await POST(req(SEGREDO, {}))).status).toBe(401);
    process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  });
});
