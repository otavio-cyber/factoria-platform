import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { adminListTenants, requireSuperAdmin } from "@/lib/auth";
import { ChatwootStatus } from "./chatwoot-actions";
import { OwnerActions } from "./owner-actions";

export const metadata: Metadata = { title: "Admin" };

const STATUS = { active: "Ativo", suspended: "Suspenso", canceled: "Cancelado" } as Record<string, string>;

export default async function AdminPage() {
  const { user, proof } = await requireSuperAdmin(); // 404 para quem não é super admin
  const tenants = await adminListTenants(proof);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Restaurantes</h1>
          <p className="text-sm text-neutral-500">{user.name} · super admin</p>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/admin/novo"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">
            Novo restaurante
          </Link>
          <SignOutButton />
        </nav>
      </header>

      {tenants.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum restaurante cadastrado ainda.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 font-medium">Nome</th>
              <th className="py-2 font-medium">Endereço</th>
              <th className="py-2 font-medium">Dono</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Atendimento</th>
              <th className="py-2 font-medium">Suporte</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-neutral-800">
            {tenants.map((t) => (
              <tr key={t.id}>
                <td className="py-2">
                  <Link href={`/t/${t.slug}`} className="hover:underline">{t.name}</Link>
                </td>
                <td className="py-2 font-mono text-neutral-500">/t/{t.slug}</td>
                <td className="py-2">
                  {t.owner_email ? (
                    <>
                      <div>{t.owner_name}</div>
                      <div className="text-xs text-neutral-500">{t.owner_email}</div>
                      <div className={`text-xs ${t.owner_activated ? "text-green-600" : "text-amber-600"}`}>
                        {t.owner_activated ? "Conta ativada" : "Aguardando ativação"}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-500">sem dono</span>
                  )}
                </td>
                <td className="py-2">{STATUS[t.status] ?? t.status}</td>
                <td className="py-2 align-top">
                  <ChatwootStatus tenantId={t.id} accountId={t.chatwoot_account_id} error={t.chatwoot_error} />
                </td>
                <td className="py-2 align-top">
                  {t.owner_user_id && t.owner_email && (
                    <OwnerActions tenantId={t.id} userId={t.owner_user_id} email={t.owner_email} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
