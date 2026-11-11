import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { NovoRestauranteForm } from "./novo-form";

export const metadata: Metadata = { title: "Novo restaurante" };

export default async function NovoRestaurantePage() {
  await requireSuperAdmin();
  return (
    <main className="mx-auto w-full max-w-lg flex-1 space-y-6 p-6">
      <header>
        <Link href="/admin" className="text-sm text-neutral-500 hover:underline">← Restaurantes</Link>
        <h1 className="mt-2 text-xl font-semibold">Novo restaurante</h1>
      </header>
      <NovoRestauranteForm />
    </main>
  );
}
