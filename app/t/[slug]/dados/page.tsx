import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { getTenantProfile } from "@/lib/db";
import { FotoUpload } from "@/components/foto-upload";
import { mediaUrl } from "@/lib/media/keys";
import { DadosForm } from "./dados-form";

export const metadata: Metadata = { title: "Dados do restaurante" };

export default async function DadosPage({ params }: PageProps<"/t/[slug]/dados">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug); // 404 se não tiver acesso
  const profile = await getTenantProfile(tenant.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {profile.name}</Link>
        <h1 className="text-xl font-semibold">Dados do restaurante</h1>
        <p className="text-sm text-neutral-500">
          Horário, endereço e contato do restaurante. Serão usados pelo atendimento automático e pelo cardápio online (próximas etapas).
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Logo e capa</h2>
        <p className="text-xs text-neutral-500">Aparecem no topo do cardápio online. A capa fica melhor em formato largo (paisagem).</p>
        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
          <FotoUpload slug={tenant.slug} alvo={{ tipo: "logo" }} url={mediaUrl(profile.logoKey)} rotulo="Logo"
            podeEditar={role !== "tenant_operator"} />
          <FotoUpload slug={tenant.slug} alvo={{ tipo: "capa" }} url={mediaUrl(profile.coverKey)} rotulo="Capa"
            formato="capa" podeEditar={role !== "tenant_operator"} />
        </div>
      </section>
      <DadosForm
        profile={profile}
        podeEditar={role !== "tenant_operator"}
        superAdmin={role === "super_admin"}
      />
    </main>
  );
}
