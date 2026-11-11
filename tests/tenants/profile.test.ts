/** Regras puras do cadastro do restaurante: CNPJ, telefone, horário e "aberto agora?". */
import { describe, expect, it } from "vitest";
import {
  cnpjValido,
  fiscalSchema,
  isOpenAt,
  openStatus,
  openingHoursSchema,
  phoneToE164,
  profileSchema,
  type OpeningHours,
} from "@/lib/tenants/profile";

describe("CNPJ", () => {
  it("aceita CNPJ válido com ou sem máscara", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
  });
  it("recusa dígito errado, tamanho errado e repetidos", () => {
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });
  it("fiscalSchema guarda só dígitos e aceita vazio", () => {
    expect(fiscalSchema.parse({ legalName: " Casa Exemplo Ltda ", cnpj: "11.222.333/0001-81" })).toEqual({
      legalName: "Casa Exemplo Ltda",
      cnpj: "11222333000181",
    });
    expect(fiscalSchema.parse({ legalName: "", cnpj: "" })).toEqual({ legalName: null, cnpj: null });
  });
});

describe("telefone", () => {
  it("converte para E.164", () => {
    expect(phoneToE164("(11) 99999-8888")).toBe("+5511999998888");
    expect(phoneToE164("(11) 3333-4444")).toBe("+551133334444");
    expect(phoneToE164("+55 11 99999-8888")).toBe("+5511999998888");
  });
  it("recusa número sem DDD ou com zero na frente", () => {
    expect(phoneToE164("99999-8888")).toBeNull();
    expect(phoneToE164("011999998888")).toBeNull();
  });
});

describe("horário de funcionamento", () => {
  // Terça (2): almoço + jantar. Sexta (5): 18h às 02h (atravessa a meia-noite).
  const h: OpeningHours = { "2": [["11:00", "15:00"], ["18:00", "23:00"]], "5": [["18:00", "02:00"]] };
  const tz = "America/Sao_Paulo"; // UTC-3
  const em = (iso: string) => new Date(iso);

  it("aberto dentro do turno, fechado entre turnos e em dia ausente", () => {
    expect(isOpenAt(h, tz, em("2026-09-29T15:30:00Z"))).toBe(true); // ter 12:30
    expect(isOpenAt(h, tz, em("2026-09-29T19:00:00Z"))).toBe(false); // ter 16:00
    expect(isOpenAt(h, tz, em("2026-09-29T02:30:00Z"))).toBe(false); // seg 23:30 (segunda ausente)
    expect(isOpenAt(h, tz, em("2026-09-30T02:00:00Z"))).toBe(false); // ter 23:00 em ponto: fechou
  });

  it("turno que atravessa a meia-noite vale até a madrugada do dia seguinte", () => {
    expect(isOpenAt(h, tz, em("2026-10-03T04:30:00Z"))).toBe(true); // sáb 01:30 (resto de sexta)
    expect(isOpenAt(h, tz, em("2026-10-03T05:30:00Z"))).toBe(false); // sáb 02:30
    expect(isOpenAt(h, tz, em("2026-10-02T21:30:00Z"))).toBe(true); // sex 18:30
  });

  it("valida formato e sobreposição", () => {
    expect(openingHoursSchema.safeParse({ "1": [["11:00", "15:00"], ["14:00", "18:00"]] }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ "1": [["25:00", "15:00"]] }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ "7": [["11:00", "15:00"]] }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ "1": [["11:00", "11:00"]] }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ "1": [["11:00", "15:00"], ["18:00", "01:00"]] }).success).toBe(true);
  });
});

describe("profileSchema", () => {
  const base = {
    name: "Casa Exemplo", category: "churrascaria", phone: "(11) 3333-4444",
    addressZip: "01310-100", addressStreet: "Av. Paulista", addressNumber: "1000", addressComplement: "",
    addressDistrict: "Bela Vista", addressCity: "São Paulo", addressState: "sp", openingHours: {},
  };
  it("normaliza campos", () => {
    const p = profileSchema.parse(base);
    expect(p).toMatchObject({ phone: "+551133334444", addressZip: "01310100", addressState: "SP", addressComplement: null });
  });
  it("recusa categoria fora da lista e CEP curto", () => {
    expect(profileSchema.safeParse({ ...base, category: "sushi" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, addressZip: "0131" }).success).toBe(false);
  });
});

describe("openStatus", () => {
  // Terça (2): 11–15 e 18–23. Sexta (5): 18–02.
  const h: OpeningHours = { "2": [["11:00", "15:00"], ["18:00", "23:00"]], "5": [["18:00", "02:00"]] };
  const tz = "America/Sao_Paulo";
  const em = (iso: string) => new Date(iso);

  it("aberto: diz até que horas", () => {
    expect(openStatus(h, tz, em("2026-09-29T15:30:00Z"))).toEqual({ state: "open", closesAt: "15:00" }); // ter 12:30
    expect(openStatus(h, tz, em("2026-10-03T04:30:00Z"))).toEqual({ state: "open", closesAt: "02:00" }); // sáb 01:30
  });
  it("fechado: próximo turno hoje, amanhã ou no dia da semana", () => {
    expect(openStatus(h, tz, em("2026-09-29T19:00:00Z"))).toEqual({ state: "closed", opensAt: "18:00", day: "hoje" }); // ter 16:00
    expect(openStatus(h, tz, em("2026-09-29T12:00:00Z"))).toEqual({ state: "closed", opensAt: "11:00", day: "hoje" }); // ter 09:00
    expect(openStatus(h, tz, em("2026-09-30T03:00:00Z"))).toEqual({ state: "closed", opensAt: "18:00", day: "Sexta" }); // qua 00:00
    expect(openStatus(h, tz, em("2026-10-01T20:00:00Z"))).toEqual({ state: "closed", opensAt: "18:00", day: "amanhã" }); // qui 17:00
  });
  it("sem horário cadastrado: não afirma nada", () => {
    expect(openStatus({}, tz)).toEqual({ state: "unknown" });
  });
});
