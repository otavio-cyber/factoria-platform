import type { Metadata } from "next";
import { Toaster } from "@/components/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Factoria", template: "%s · Factoria" },
  description: "Atendimento, CRM e automação para restaurantes.",
  robots: { index: false, follow: false }, // painel privado
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col" suppressHydrationWarning /* extensões do navegador alteram o <body> */>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
