import { describe, expect, it } from "vitest";
import {
  instanceNameFor,
  mapState,
  orderStatusMessage,
  parseEvolutionEvent,
  phoneFromJid,
  tenantIdFromInstance,
  toWhatsappNumber,
} from "@/lib/whatsapp/rules";

const T = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";

describe("instância por restaurante", () => {
  it("nome derivado do id e volta para o id", () => {
    expect(instanceNameFor(T)).toBe(`factoria-${T}`);
    expect(tenantIdFromInstance(instanceNameFor(T))).toBe(T);
  });
  it("recusa nomes que não são nossos", () => {
    for (const n of ["outra", `x-${T}`, "factoria-123", "factoria-../../etc", null, 42]) expect(tenantIdFromInstance(n)).toBeNull();
  });
});

describe("números", () => {
  it("E.164 → dígitos; jid → dígitos", () => {
    expect(toWhatsappNumber("+5516999998888")).toBe("5516999998888");
    expect(phoneFromJid("5516999998888@s.whatsapp.net")).toBe("5516999998888");
    expect(phoneFromJid("x@g.us")).toBeNull();
  });
  it("estado da Evolution → status", () => {
    expect(mapState("open")).toBe("connected");
    expect(mapState("connecting")).toBe("connecting");
    expect(mapState("close")).toBe("disconnected");
    expect(mapState(undefined)).toBe("disconnected");
  });
});

describe("mensagens do pedido", () => {
  const base = { type: "delivery" as const, number: 12, customerName: "Maria da Silva", restaurantName: "Casa Exemplo", trackUrl: "https://x/p/tok" };
  it("recebido traz primeiro nome e link de acompanhamento", () => {
    const m = orderStatusMessage({ ...base, status: "received" });
    expect(m).toContain("Olá, Maria!");
    expect(m).toContain("#12");
    expect(m).toContain("https://x/p/tok");
  });
  it("cada etapa tem texto, e retirada é diferente de entrega", () => {
    expect(orderStatusMessage({ ...base, status: "out_for_delivery" })).toContain("saiu para entrega");
    expect(orderStatusMessage({ ...base, type: "pickup", status: "ready" })).toContain("pronto para retirada");
    expect(orderStatusMessage({ ...base, type: "pickup", status: "delivered" })).toContain("retirado");
    expect(orderStatusMessage({ ...base, status: "canceled", cancelReason: "sem entregador" })).toContain("Motivo: sem entregador");
  });
});

describe("eventos da Evolution", () => {
  it("lê conexão aberta com número", () => {
    expect(
      parseEvolutionEvent({ event: "connection.update", instance: `factoria-${T}`, data: { state: "open", wuid: "5516999998888@s.whatsapp.net" } }),
    ).toEqual({ kind: "connection", tenantId: T, status: "connected", phone: "5516999998888" });
  });
  it("aceita o nome do evento em maiúsculas e ignora o resto", () => {
    expect(parseEvolutionEvent({ event: "CONNECTION_UPDATE", instance: `factoria-${T}`, data: { state: "close" } })).toMatchObject({
      kind: "connection",
      status: "disconnected",
    });
    expect(parseEvolutionEvent({ event: "messages.upsert", instance: `factoria-${T}`, data: {} })).toEqual({ kind: "ignored" });
    expect(parseEvolutionEvent({ event: "connection.update", instance: "estranha", data: { state: "open" } })).toEqual({ kind: "ignored" });
    expect(parseEvolutionEvent("lixo")).toEqual({ kind: "ignored" });
  });
});
