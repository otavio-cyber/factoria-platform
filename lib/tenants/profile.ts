/**
 * Dados cadastrais e horário de funcionamento do restaurante — regras puras (sem banco),
 * usadas pelo formulário, pelas Server Actions e, no futuro, pelo robô e pelo cardápio.
 */
import { z } from "zod";

// ─── Categoria ──────────────────────────────────────────────────────────────
export const CATEGORIES = {
  churrascaria: "Churrascaria",
  japonesa: "Japonesa",
  pizzaria: "Pizzaria",
  lanchonete: "Lanchonete",
  hamburgueria: "Hamburgueria",
  restaurante: "Restaurante / self-service",
  marmitaria: "Marmitaria",
  bar: "Bar / petiscaria",
  cafeteria: "Cafeteria / padaria",
  doceria: "Doceria / sorveteria",
  outra: "Outra",
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as [Category, ...Category[]];

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const onlyDigits = (v: string) => v.replace(/\D/g, "");

// ─── CNPJ ───────────────────────────────────────────────────────────────────
export function cnpjValido(valor: string): boolean {
  const c = onlyDigits(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export const formatCnpj = (c: string) =>
  onlyDigits(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

// ─── Telefone (Brasil → E.164) ──────────────────────────────────────────────
/** "(11) 99999-8888" → "+5511999998888". Aceita fixo (10 dígitos) e celular (11). */
export function phoneToE164(valor: string): string | null {
  let d = onlyDigits(valor);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.startsWith("0")) return null;
  return `+55${d}`;
}

export function formatPhoneBr(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/^\+55/, "");
  return d.length === 11
    ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3")
    : d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
}

// ─── Horário de funcionamento ───────────────────────────────────────────────
/** Chave = dia da semana como no JS (0 = domingo … 6 = sábado). Dia ausente = fechado. */
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const intervalSchema = z
  .tuple([z.string().regex(HHMM), z.string().regex(HHMM)])
  .refine(([a, b]) => a !== b, "Abertura e fechamento iguais");

export const openingHoursSchema = z
  .partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(intervalSchema).max(3))
  .refine(
    (h) => Object.values(h).every((dia) => semSobreposicao(dia ?? [])),
    "Há turnos sobrepostos no mesmo dia",
  );
export type OpeningHours = z.infer<typeof openingHoursSchema>;

const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Turnos do mesmo dia não podem se sobrepor (turno que passa da meia-noite vale até 24:00 aqui). */
function semSobreposicao(turnos: Array<[string, string]>): boolean {
  const faixas = turnos
    .map(([a, b]) => [min(a), min(b) > min(a) ? min(b) : 24 * 60] as const)
    .sort((x, y) => x[0] - y[0]);
  return faixas.every((f, i) => i === 0 || f[0] >= faixas[i - 1][1]);
}

/** Dia da semana e minuto do dia no fuso do restaurante. */
function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * O restaurante está aberto neste instante? Turno com fechamento menor que a abertura
 * atravessa a meia-noite (ex.: sexta 18:00–02:00 vale até sábado 02:00).
 */
export function isOpenAt(hours: OpeningHours, timezone: string, date: Date = new Date()): boolean {
  const { weekday, minute } = localParts(date, timezone);
  const hoje = hours[String(weekday) as keyof OpeningHours] ?? [];
  const ontem = hours[String((weekday + 6) % 7) as keyof OpeningHours] ?? [];
  const abertoHoje = hoje.some(([a, b]) => {
    const [ia, fb] = [min(a), min(b)];
    return fb > ia ? minute >= ia && minute < fb : minute >= ia;
  });
  const restoDeOntem = ontem.some(([a, b]) => min(b) < min(a) && minute < min(b));
  return abertoHoje || restoDeOntem;
}

// ─── Formulários ────────────────────────────────────────────────────────────
const opcional = (s: z.ZodString) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable());

/** Dados que o dono (Administrador) edita. */
export const profileSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do restaurante").max(80),
  category: z.enum(CATEGORY_KEYS, { error: "Escolha a categoria" }),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const e = phoneToE164(v);
      if (!e) ctx.addIssue({ code: "custom", message: "Telefone inválido (DDD + número)" });
      return e ?? z.NEVER;
    }),
  addressZip: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || v.length === 8, "CEP deve ter 8 dígitos")
    .transform((v) => (v === "" ? null : v)),
  addressStreet: opcional(z.string().trim().max(120)),
  addressNumber: opcional(z.string().trim().max(20)),
  addressComplement: opcional(z.string().trim().max(60)),
  addressDistrict: opcional(z.string().trim().max(80)),
  addressCity: opcional(z.string().trim().max(80)),
  addressState: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim().toUpperCase() : v),
    z.enum(UFS, { error: "UF inválida" }).nullable(),
  ),
  openingHours: openingHoursSchema,
});
export type ProfileInput = z.input<typeof profileSchema>;
export type Profile = z.output<typeof profileSchema>;

/** Dados fiscais: só a equipe Factoria altera. */
export const fiscalSchema = z.object({
  legalName: opcional(z.string().trim().min(2).max(120)),
  cnpj: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || cnpjValido(v), "CNPJ inválido")
    .transform((v) => (v === "" ? null : v)),
});
export type Fiscal = z.output<typeof fiscalSchema>;

/** Domínio próprio da vitrine (ex.: app.restaurante.com.br). Nunca um domínio da Factoria. */
export const customDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  .refine((v) => v === "" || /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v), "Domínio inválido (ex.: app.restaurante.com.br)")
  .refine((v) => !/(^|\.)factoria\.dev\.br$/.test(v), "Use um domínio do restaurante, não da Factoria")
  .transform((v) => (v === "" ? null : v));

// ─── Situação agora (para a vitrine e o atendimento) ────────────────────────
export type OpenStatus =
  | { state: "open"; closesAt: string }
  | { state: "closed"; opensAt: string; day: "hoje" | "amanhã" | (typeof WEEKDAYS)[number] }
  | { state: "unknown" };

/**
 * Aberto agora (e até que horas) ou quando abre de novo, no fuso do restaurante.
 * Sem horário cadastrado → "unknown" (a vitrine não afirma nada).
 */
export function openStatus(hours: OpeningHours, timezone: string, date: Date = new Date()): OpenStatus {
  const dias = Object.values(hours).filter((d) => (d?.length ?? 0) > 0);
  if (dias.length === 0) return { state: "unknown" };
  const { weekday, minute } = localParts(date, timezone);
  const turnos = (d: number) => hours[String(((d % 7) + 7) % 7) as keyof OpeningHours] ?? [];

  // Aberto: turno de hoje em andamento, ou resto de um turno de ontem que passou da meia-noite.
  for (const [a, b] of turnos(weekday)) {
    const [ia, fb] = [min(a), min(b)];
    if (fb > ia ? minute >= ia && minute < fb : minute >= ia) return { state: "open", closesAt: b };
  }
  for (const [a, b] of turnos(weekday - 1)) {
    if (min(b) < min(a) && minute < min(b)) return { state: "open", closesAt: b };
  }

  // Fechado: próximo turno a começar (hoje mais tarde, ou nos próximos 7 dias).
  for (let i = 0; i <= 7; i++) {
    const proximos = turnos(weekday + i)
      .map(([a]) => a)
      .filter((a) => i > 0 || min(a) > minute)
      .sort();
    if (proximos.length) {
      const day = i === 0 ? "hoje" : i === 1 ? "amanhã" : WEEKDAYS[(weekday + i) % 7];
      return { state: "closed", opensAt: proximos[0], day };
    }
  }
  return { state: "unknown" };
}
