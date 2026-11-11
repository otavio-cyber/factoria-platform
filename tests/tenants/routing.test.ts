/** Domínio próprio do restaurante: só a vitrine; o painel continua só no domínio do app. */
import { describe, expect, it } from "vitest";
import { precisaLogin, rotaNoDominio, vitrineBase } from "@/lib/tenants/routing";
import { customDomainSchema } from "@/lib/tenants/profile";

describe("domínio do restaurante", () => {
  it("raiz abre a vitrine; fotos e arquivos do site passam", () => {
    expect(rotaNoDominio("/")).toEqual({ tipo: "vitrine", caminho: "" });
    expect(rotaNoDominio("/pedido")).toEqual({ tipo: "vitrine", caminho: "/pedido" });
    expect(rotaNoDominio("/p/AbC_123-xyzAbC_123-xyz12")).toEqual({ tipo: "vitrine", caminho: "/p/AbC_123-xyzAbC_123-xyz12" });
    expect(rotaNoDominio("/midia/t/x/item/y.webp")).toEqual({ tipo: "liberar" });
    expect(rotaNoDominio("/_next/static/chunk.js")).toEqual({ tipo: "liberar" });
  });
  it("login, painel, API e vitrine de OUTRO restaurante não existem ali", () => {
    for (const p of ["/login", "/admin", "/t/alta-brasa", "/api/auth/sign-in/email", "/ativar", "/c/outro", "/api/health", "/p/../../x", "/pedido/x"]) {
      expect(rotaNoDominio(p)).toEqual({ tipo: "nao-encontrado" });
    }
  });
  it("links da vitrine: sem prefixo no domínio do restaurante", () => {
    expect(vitrineBase("cardapio.restaurante.com.br", "alta", ["app.factoria.dev.br"])).toBe("");
    expect(vitrineBase("app.factoria.dev.br", "alta", ["app.factoria.dev.br"])).toBe("/c/alta");
  });
});

describe("domínio do app", () => {
  it("áreas logadas exigem sessão; vitrine e saúde não", () => {
    expect(precisaLogin("/")).toBe(true);
    expect(precisaLogin("/admin")).toBe(true);
    expect(precisaLogin("/t/demo/cardapio")).toBe(true);
    expect(precisaLogin("/c/demo")).toBe(false);
    expect(precisaLogin("/login")).toBe(false);
    expect(precisaLogin("/api/health")).toBe(false);
    expect(precisaLogin("/administracao")).toBe(false);
  });
});

describe("cadastro do domínio", () => {
  it("normaliza e valida", () => {
    expect(customDomainSchema.parse(" https://App.Restaurante-Exemplo.com.br/ ")).toBe("app.restaurante-exemplo.com.br");
    expect(customDomainSchema.parse("")).toBeNull();
    expect(customDomainSchema.safeParse("não é domínio").success).toBe(false);
  });
  it("recusa domínio da própria Factoria", () => {
    expect(customDomainSchema.safeParse("app.factoria.dev.br").success).toBe(false);
    expect(customDomainSchema.safeParse("factoria.dev.br").success).toBe(false);
  });
});
