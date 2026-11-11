import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { myTenants } from "@/lib/auth";

export default async function Home() {
  const { user, tenants } = await myTenants();
  const ativos = tenants.filter((t) => t.status === "active");

  // Equipe Factoria vai para a administração; usuário de um restaurante só vai direto ao painel.
  if (user.role === "super_admin") redirect("/admin");
  if (ativos.length === 1) redirect(`/t/${ativos[0].slug}`);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Olá, {user.name}</h1>
          <p className="text-sm text-neutral-500">
            Escolha o restaurante
          </p>
        </div>
        <SignOutButton />
      </header>

      {ativos.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Seu usuário ainda não está vinculado a nenhum restaurante. Fale com a Factoria.
        </p>
      ) : (
        <ul className="divide-y rounded-md border dark:divide-neutral-800 dark:border-neutral-800">
          {ativos.map((t) => (
            <li key={t.id}>
              <Link href={`/t/${t.slug}`} className="flex justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <span>{t.name}</span>
                <span className="text-sm text-neutral-500">{t.role === "tenant_admin" ? "Administrador" : "Atendente"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
