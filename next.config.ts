import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // painel não pode ser embutido em iframe (clickjacking)
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS fica a cargo da Cloudflare (borda HTTPS).
];

const nextConfig: NextConfig = {
  output: "standalone", // imagem Docker enxuta (só os arquivos necessários)
  poweredByHeader: false,
  experimental: {
    // Fotos chegam já reduzidas pelo navegador (até 1,5 MB); o resto continua pequeno.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
