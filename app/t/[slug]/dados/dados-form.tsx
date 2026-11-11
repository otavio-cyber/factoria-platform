"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { TenantProfile } from "@/lib/db";
import {
  CATEGORIES,
  UFS,
  WEEKDAYS,
  formatCnpj,
  formatPhoneBr,
  onlyDigits,
  type OpeningHours,
} from "@/lib/tenants/profile";
import { salvarDados } from "./actions";

const input =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 disabled:opacity-60 dark:border-neutral-700";

type Turno = [string, string];
type Dias = Record<string, Turno[]>;
const ORDEM_DIAS = ["1", "2", "3", "4", "5", "6", "0"]; // segunda primeiro

export function DadosForm({
  profile,
  podeEditar,
  superAdmin,
}: {
  profile: TenantProfile;
  podeEditar: boolean;
  superAdmin: boolean;
}) {
  const [f, setF] = useState({
    name: profile.name,
    category: profile.category ?? "",
    phone: formatPhoneBr(profile.phone),
    addressZip: profile.addressZip ? profile.addressZip.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "",
    addressStreet: profile.addressStreet ?? "",
    addressNumber: profile.addressNumber ?? "",
    addressComplement: profile.addressComplement ?? "",
    addressDistrict: profile.addressDistrict ?? "",
    addressCity: profile.addressCity ?? "",
    addressState: profile.addressState ?? "",
    legalName: profile.legalName ?? "",
    cnpj: profile.cnpj ? formatCnpj(profile.cnpj) : "",
    customDomain: profile.customDomain ?? "",
  });
  const [dias, setDias] = useState<Dias>(() => ({ ...(profile.openingHours as Dias) }));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  // Preenche o endereço pelo CEP (ViaCEP, chamada direta do navegador; não envia nada além do CEP).
  async function buscarCep() {
    const cep = onlyDigits(f.addressZip);
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (d.erro) {
        toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        return;
      }
      setF((v) => ({
        ...v,
        addressStreet: d.logradouro || v.addressStreet,
        addressDistrict: d.bairro || v.addressDistrict,
        addressCity: d.localidade || v.addressCity,
        addressState: d.uf || v.addressState,
      }));
    } catch {
      toast.error("Não foi possível consultar o CEP agora. Preencha manualmente.");
    } finally {
      setBuscandoCep(false);
    }
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    const openingHours = Object.fromEntries(
      Object.entries(dias).filter(([, turnos]) => turnos.length > 0),
    ) as OpeningHours;
    const profilePayload = {
      name: f.name,
      category: f.category,
      phone: f.phone,
      addressZip: f.addressZip,
      addressStreet: f.addressStreet,
      addressNumber: f.addressNumber,
      addressComplement: f.addressComplement,
      addressDistrict: f.addressDistrict,
      addressCity: f.addressCity,
      addressState: f.addressState,
      openingHours,
    };
    startTransition(async () => {
      const r = await salvarDados(profile.slug, {
        profile: profilePayload,
        fiscal: superAdmin ? { legalName: f.legalName, cnpj: f.cnpj } : undefined,
        customDomain: superAdmin ? f.customDomain : undefined,
      });
      if (r.ok) {
        setErros({});
        toast.success("Dados salvos.");
      } else {
        setErros(r.fields);
        toast.error(r.message);
      }
    });
  }

  const off = !podeEditar || pending;

  return (
    <form onSubmit={salvar} className="space-y-8">
      {!podeEditar && (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">
          Somente leitura. Peça ao administrador do restaurante para alterar estes dados.
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Restaurante</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nome (como o cliente conhece)" erro={erros.name}>
            <input value={f.name} onChange={set("name")} disabled={off} required className={input} />
          </Campo>
          <Campo label="Categoria" erro={erros.category}>
            <select value={f.category} onChange={set("category")} disabled={off} className={input}>
              <option value="">Escolha…</option>
              {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Campo>
          <Campo label="Telefone" erro={erros.phone} dica="Número fixo ou celular com DDD">
            <input value={f.phone} onChange={set("phone")} disabled={off} inputMode="tel"
              placeholder="(11) 99999-8888" className={input} />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Dados gerenciados pela Factoria</legend>
        {!superAdmin && (
          <p className="text-xs text-neutral-500">Para alterar razão social, CNPJ ou o endereço do cardápio, fale com a Factoria.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Razão social" erro={erros.legalName}>
            <input value={f.legalName} onChange={set("legalName")} disabled={off || !superAdmin} className={input} />
          </Campo>
          <Campo label="CNPJ" erro={erros.cnpj}>
            <input value={f.cnpj} onChange={set("cnpj")} disabled={off || !superAdmin} inputMode="numeric"
              placeholder="00.000.000/0000-00" className={input} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo label="Endereço próprio do cardápio (opcional)" erro={erros.customDomain}
              dica={`Sem endereço próprio, o cardápio fica em app.factoria.dev.br/c/${profile.slug}`}>
              <input value={f.customDomain} onChange={set("customDomain")} disabled={off || !superAdmin}
                placeholder="app.restaurante.com.br" className={input} />
            </Campo>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Endereço</legend>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Campo label="CEP" erro={erros.addressZip} dica={buscandoCep ? "Buscando…" : "Preenche o endereço"}>
              <input value={f.addressZip} onChange={set("addressZip")} onBlur={buscarCep} disabled={off}
                inputMode="numeric" placeholder="00000-000" className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-4">
            <Campo label="Rua / avenida" erro={erros.addressStreet}>
              <input value={f.addressStreet} onChange={set("addressStreet")} disabled={off} className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo label="Número" erro={erros.addressNumber}>
              <input value={f.addressNumber} onChange={set("addressNumber")} disabled={off} className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-4">
            <Campo label="Complemento" erro={erros.addressComplement}>
              <input value={f.addressComplement} onChange={set("addressComplement")} disabled={off} className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-3">
            <Campo label="Bairro" erro={erros.addressDistrict}>
              <input value={f.addressDistrict} onChange={set("addressDistrict")} disabled={off} className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo label="Cidade" erro={erros.addressCity}>
              <input value={f.addressCity} onChange={set("addressCity")} disabled={off} className={input} />
            </Campo>
          </div>
          <div className="sm:col-span-1">
            <Campo label="UF" erro={erros.addressState}>
              <select value={f.addressState} onChange={set("addressState")} disabled={off} className={input}>
                <option value="">—</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Campo>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Horário de funcionamento</legend>
        <p className="text-xs text-neutral-500">
          Até 3 turnos por dia. Fechamento antes da abertura atravessa a meia-noite (ex.: 18:00 às 02:00).
          Fuso: {profile.timezone}.
        </p>
        {erros.openingHours && <p className="text-sm text-red-600">{erros.openingHours}</p>}
        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {ORDEM_DIAS.map((d) => (
            <Dia key={d} nome={WEEKDAYS[Number(d)]} turnos={dias[d] ?? []} disabled={off}
              onChange={(t) => setDias((v) => ({ ...v, [d]: t }))} />
          ))}
        </div>
      </fieldset>

      {podeEditar && (
        <button type="submit" disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {pending ? "Salvando..." : "Salvar"}
        </button>
      )}
    </form>
  );
}

function Dia({ nome, turnos, disabled, onChange }: {
  nome: string;
  turnos: Turno[];
  disabled: boolean;
  onChange: (t: Turno[]) => void;
}) {
  const aberto = turnos.length > 0;
  const mudar = (i: number, j: 0 | 1, v: string) =>
    onChange(turnos.map((t, k) => (k === i ? ((j === 0 ? [v, t[1]] : [t[0], v]) as Turno) : t)));
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2">
      <label className="flex w-32 items-center gap-2 text-sm">
        <input type="checkbox" checked={aberto} disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? [["11:00", "15:00"]] : [])} />
        {nome}
      </label>
      {!aberto && <span className="text-sm text-neutral-500">Fechado</span>}
      {turnos.map((t, i) => (
        <span key={i} className="flex items-center gap-1 text-sm">
          <input type="time" value={t[0]} disabled={disabled} onChange={(e) => mudar(i, 0, e.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-700" />
          às
          <input type="time" value={t[1]} disabled={disabled} onChange={(e) => mudar(i, 1, e.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-1 dark:border-neutral-700" />
          {!disabled && turnos.length > 1 && (
            <button type="button" aria-label="Remover turno" onClick={() => onChange(turnos.filter((_, k) => k !== i))}
              className="px-1 text-neutral-500 hover:text-red-600">×</button>
          )}
        </span>
      ))}
      {aberto && !disabled && turnos.length < 3 && (
        <button type="button" onClick={() => onChange([...turnos, ["18:00", "23:00"]])}
          className="text-sm text-neutral-500 hover:underline">+ turno</button>
      )}
    </div>
  );
}

function Campo({ label, erro, dica, children }: { label: string; erro?: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      {children}
      {erro ? <span className="block text-xs text-red-600">{erro}</span> : dica && <span className="block text-xs text-neutral-500">{dica}</span>}
    </label>
  );
}
