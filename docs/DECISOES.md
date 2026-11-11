# Decisões de arquitetura

Registro das decisões que mais moldam o Factoria SaaS e do motivo de cada uma.

## 1. Isolamento entre restaurantes no banco (RLS), fail-closed

Toda tabela de negócio tem `tenant_id UUID NOT NULL` e Row Level Security **ativo e forçado**.

```sql
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;      -- vale até para o dono da tabela
CREATE POLICY tenant_isolation ON contacts
  USING      (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);
```

Por que exatamente assim:

- **`current_setting(..., true)` + `nullif`:** se o tenant não foi definido, a consulta devolve **zero linhas** em vez de erro ou vazamento. É o comportamento fail-closed.
- **`WITH CHECK`:** impede que o restaurante B grave uma linha com o `tenant_id` do restaurante A.
- **`FORCE`:** sem ele, o dono da tabela ignora o RLS.
- **Usuário do app sem ownership:** o app roda com um papel que não cria tabelas nem desliga o RLS.

**Como o app define o tenant:** sempre dentro de uma transação, com `set_config('app.current_tenant', $1, true)`. O `true` torna o valor local à transação, o que é seguro com pool de conexões. O acesso ao banco passa por um único helper, `withTenant()`, e o ESLint bloqueia qualquer outro caminho.

**Garantias no CI:** o build falha se alguma tabela com `tenant_id` ficar sem RLS completo, e há testes de isolamento rodando contra um Postgres real.

## 2. Painel por caminho, não por subdomínio

O painel de cada restaurante fica em `app.<domínio>/t/<slug>`, e não em `<slug>.<domínio>`.

Um login que valha para vários subdomínios exige um cookie de sessão no domínio raiz. Se esse domínio também hospeda sites de terceiros, o navegador enviaria o cookie de sessão do SaaS para todos eles. Por isso os cookies são **host-only**.

Subdomínio por restaurante continua possível para páginas **públicas e sem login**, onde não há cookie de sessão. Se um dia o painel precisar de subdomínio, o caminho seguro é um domínio exclusivo do SaaS.

## 3. Usuários no Chatwoot com e-mail técnico

Cada usuário existe no Chatwoot com o e-mail `<user_id>@chatwoot.<domínio>.invalid`, **nunca** com o e-mail real.

A Platform API do Chatwoot, ao "criar" um usuário cujo e-mail já existe, **adota o usuário existente** e passa a permitir gerar login automático (SSO) para ele. Com e-mail real, o app poderia gerar login para contas que não são dele, como o super admin do Chatwoot. Com e-mail técnico isso não acontece, e a única entrada do usuário no Chatwoot passa a ser o botão do SaaS.

Regras que acompanham essa decisão:

- Membros entram como **agente**, nunca administrador (administradores podem criar webhooks para a rede interna).
- O app só **lê** a ligação usuário↔Chatwoot. Gravar passa por funções do super admin no banco.
- "Abrir atendimento" é uma Server Action (POST), então nenhum GET gera token de login.

## 4. Super admin por prova, não por flag

O app não tem permissão para criar restaurantes. Isso passa por funções do banco que só funcionam dentro de `withSuperAdmin()`, e as operações de administração exigem uma prova (`SuperAdminProof`) que só `requireSuperAdmin()` emite.

## 5. Não construir o que já existe

No MVP, n8n (automação) e Chatwoot (atendimento) fazem o trabalho pesado. Só serão substituídos quando clientes reais pedirem algo que eles não suportam.
