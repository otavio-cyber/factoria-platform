# Factoria SaaS

Plataforma multi-tenant de automação de atendimento e marketing para restaurantes.

- **Decisões de arquitetura:** [`docs/DECISOES.md`](docs/DECISOES.md)
- **Status:** em desenvolvimento ativo
- **Stack:** Next.js 16 · TypeScript · Drizzle · PostgreSQL 16 (RLS) · Redis/BullMQ · Better Auth · n8n · Chatwoot
- **Infra:** Docker Compose, publicada via Cloudflare Tunnel (sem portas web abertas)

> Nunca comite segredos. Arquivos `.env*` são ignorados; use `.env.example` como referência.

## Deploy

Merge no `main` → CI (lint, tipos, testes de isolamento entre tenants e build) → imagem de container.
O app expõe `/api/health`, usado pelo healthcheck do container.

## Desenvolvimento local

Pré-requisitos: Node 22+, pnpm, Docker (usuário no grupo `docker`).

```bash
cp .env.example .env.local   # uma vez
pnpm install
pnpm db:up                   # Postgres (pgvector) :5434 + Redis :6380 — espelho da produção
pnpm db:migrate              # aplica as migrations como factoria_owner
pnpm db:seed                 # tenant "demo" + usuários de teste (idempotente)
pnpm test                    # isolamento entre tenants (RLS) + autenticação, contra o Postgres real
pnpm dev                     # http://localhost:3000
pnpm db:down                 # ao terminar (os dados ficam no volume)
```

| Script | O que faz |
|---|---|
| `pnpm db:generate` | Gera migration a partir de `lib/db/schema.ts` |
| `pnpm db:migrate` | Aplica migrations pendentes |
| `pnpm db:reset` | Apaga e recria o banco local do zero |
| `pnpm db:psql` | Abre o psql no banco local (como admin) |
| `pnpm db:seed` | Cria o tenant `demo` e os usuários de teste |
| `pnpm auth:generate` | Regenera `lib/db/auth-schema.ts` pela CLI do Better Auth (reaplicar ajustes do cabeçalho) |

### Usuários de teste (seed, senha `factoria-dev-123`)

| E-mail | Papel |
|---|---|
| `admin@factoria.dev.br` | super_admin (acessa qualquer restaurante) |
| `dono@demo.factoria.dev.br` | tenant_admin do `demo` |
| `atendente@demo.factoria.dev.br` | tenant_operator do `demo` |
| `pnpm typecheck` / `pnpm lint` | Verificação de tipos / lint |

## Regras do banco (resumo — detalhes em docs/DECISOES.md)

- Código de negócio acessa o banco **só** por `withTenant()` de `@/lib/db` (o ESLint bloqueia o resto).
- Toda tabela nova com `tenant_id` chama `SELECT factoria_enable_tenant_rls('<tabela>');` na mesma migration.
  Crie a migration de RLS com `pnpm db:generate --custom --name rls_<tabela>`.
- Referências entre tabelas de negócio usam **FK composta** `(tenant_id, <id>)` — FK simples não passa pelo RLS.
- O CI falha se alguma tabela com `tenant_id` ficar sem RLS completo.

## Autenticação e acesso

- **Better Auth**, e-mail + senha, **cadastro público desligado** (usuários nascem no onboarding).
- Checagem de acesso **em cada página/Server Action** via `requireUser()` / `requireTenantAccess(slug)`
  (`lib/auth/index.ts`). O `proxy.ts` só faz checagem otimista de cookie.
- Painel do restaurante em `/t/<slug>`. Sem acesso → **404** (não revela se o restaurante existe).
- Cookies host-only (sem domínio compartilhado): o domínio do app também hospeda outros sites. Veja [`docs/DECISOES.md`](docs/DECISOES.md).

## Onboarding de restaurante (super admin)

1. Entre como `super_admin` → você cai em **`/admin`** (lista de restaurantes).
2. **Novo restaurante**: nome, endereço (`/t/<slug>`, sugerido pelo nome), fuso e dono (nome + e-mail).
3. Se o dono é novo, a tela mostra um **link de ativação** (válido por 48 h, uso único) para enviar a ele.
   Ele abre o link, cria a senha em `/ativar` e entra direto no painel do restaurante.
   Se o e-mail já tem conta, ele só é vinculado como administrador.

**Suporte ao dono** (lista do `/admin`): status *Aguardando ativação* / *Conta ativada*, botão **Novo link**
(invalida os anteriores) e **Corrigir e-mail** (encerra as sessões e gera link para o e-mail certo).
O cadastro pede o e-mail do dono **duas vezes** (sem colar), porque um erro de digitação deixa o dono sem acesso.

**Mensagens de erro de login:** cada situação tem a sua (limite de tentativas, endereço não autorizado, conta
bloqueada, sem conexão, link inválido), **exceto** e-mail inexistente × senha errada, que ficam iguais de propósito
para não revelar quais e-mails são clientes (enumeração de contas).

## Atendimento (Chatwoot)

Ao criar um restaurante, o app cria a **conta dele no Chatwoot** e coloca cada membro como **agente**
(Platform API). No painel do restaurante, **Abrir atendimento** leva o usuário ao Chatwoot já logado (SSO, link de 5 min).
Falhou? A lista do `/admin` mostra o erro e o botão **Tentar de novo** (idempotente: não duplica nada).

Para ativar em dev: no `.env.local`, defina `CHATWOOT_URL` (uma instância do Chatwoot que você controle)
e `CHATWOOT_PLATFORM_TOKEN=<token do Platform App>`. Contas criadas em dev recebem o prefixo `[dev] `.

**Segurança:**
- No Chatwoot, cada usuário usa um **e-mail técnico** `<id>@chatwoot.factoria.invalid`, **nunca o real**. A Platform API
  "adota" usuários já existentes com o mesmo e-mail, e o app poderia gerar login automático para contas que não são nossas
  (ex.: o super admin do Chatwoot). Efeito extra: a única entrada do usuário no Chatwoot é pelo botão do SaaS.
- Membros entram como **agente**, nunca administrador (administradores podem criar webhooks para a rede interna).
- O app **só lê** a ligação usuário↔Chatwoot; gravar passa por funções do super admin (migration 0007).
- "Abrir atendimento" é uma Server Action (POST): nenhum GET gera token de login.

Regras: o app **não** tem permissão para criar tenants; isso passa por funções do banco que só funcionam
dentro de `withSuperAdmin()`, e as operações de admin exigem a prova `SuperAdminProof` (só `requireSuperAdmin()` a emite).
Slugs reservados (rotas e serviços): `lib/tenants/slug.ts`.
