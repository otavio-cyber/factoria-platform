"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-neutral-500 underline-offset-4 hover:underline"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sair
    </button>
  );
}
