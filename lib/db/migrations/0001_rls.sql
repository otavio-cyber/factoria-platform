-- ════════════════════════════════════════════════════════════════════════════
-- 0001 — Row Level Security (isolamento entre tenants)
--
-- Como o app define o tenant (dentro de uma transação, via withTenant()):
--   SELECT set_config('app.current_tenant', '<uuid>', true);   -- true = local à transação
--
-- Comportamento garantido (testado em tests/db/rls.test.ts):
--   * tenant definido  → só enxerga/grava linhas do próprio tenant
--   * tenant ausente   → ZERO linhas (fail-closed), nunca erro nem vazamento
--   * gravar tenant_id de outro tenant → erro (WITH CHECK)
--   * FORCE → nem o dono das tabelas (factoria_owner) escapa do RLS
-- ════════════════════════════════════════════════════════════════════════════

-- Tenant da transação atual (NULL se não definido → nenhuma linha passa na policy).
CREATE OR REPLACE FUNCTION factoria_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid
$$;
--> statement-breakpoint

-- Padrão único de RLS por tenant. TODA tabela nova com tenant_id chama esta função
-- na mesma migration que a cria:  SELECT factoria_enable_tenant_rls('minha_tabela');
CREATE OR REPLACE FUNCTION factoria_enable_tenant_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING (tenant_id = factoria_current_tenant())
       WITH CHECK (tenant_id = factoria_current_tenant())',
    p_table);
END
$$;
--> statement-breakpoint
-- Só migrations (factoria_owner) usam; o app não precisa nem deve executar.
REVOKE ALL ON FUNCTION factoria_enable_tenant_rls(regclass) FROM PUBLIC, factoria_app;
--> statement-breakpoint

SELECT factoria_enable_tenant_rls('memberships');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('contacts');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('conversations');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('messages');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('reservations');
--> statement-breakpoint

-- ─── tenants: exceção documentada ──────────────────────────────────────────
-- RLS habilitado mas SEM FORCE: o owner (migrations, onboarding, resolução por slug)
-- precisa enxergar todos. O app enxerga só o próprio tenant e só altera nome/fuso.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self_select ON tenants FOR SELECT
  USING (id = factoria_current_tenant());
--> statement-breakpoint
CREATE POLICY tenant_self_update ON tenants FOR UPDATE
  USING (id = factoria_current_tenant())
  WITH CHECK (id = factoria_current_tenant());
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenants FROM factoria_app;
--> statement-breakpoint
-- plan e status NÃO: mudam só por billing/super_admin, nunca pelo painel do cliente.
GRANT UPDATE (name, timezone) ON tenants TO factoria_app;
--> statement-breakpoint

-- Resolução do tenant pelo subdomínio (antes de existir tenant na transação).
-- SECURITY DEFINER roda como factoria_owner, que não está sujeito ao RLS de tenants.
-- Expõe só id/status/timezone — nada mais sobre outros tenants.
CREATE OR REPLACE FUNCTION factoria_resolve_tenant(p_slug text)
RETURNS TABLE (id uuid, status text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.status, t.timezone FROM tenants t WHERE t.slug = lower(p_slug)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_resolve_tenant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_resolve_tenant(text) TO factoria_app;
--> statement-breakpoint

-- Nenhuma tabela aceita TRUNCATE do app (TRUNCATE ignora RLS).
REVOKE TRUNCATE ON memberships, contacts, conversations, messages, reservations FROM factoria_app;
