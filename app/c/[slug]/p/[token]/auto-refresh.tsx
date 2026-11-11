"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados da página a cada N segundos (só enquanto ela está visível). */
export function AutoRefresh({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    return () => clearInterval(t);
  }, [router, segundos]);
  return null;
}
