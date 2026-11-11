-- ════════════════════════════════════════════════════════════════════════════
-- 0003 — Visão do próprio usuário (antes de escolher um tenant)
--
-- Depois do login, o app precisa saber "em quais restaurantes este usuário trabalha".
-- Isso atravessa tenants, então não cabe no withTenant(). Solução: um segundo contexto,
-- app.current_user, definido por withUser() — que só libera:
--   * as memberships DESTE usuário (de qualquer tenant)
--   * os tenants em que ele tem membership (somente leitura)
-- Nada de contatos, conversas, mensagens ou reservas: isso continua exigindo withTenant().
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION factoria_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user', true), '')
$$;
--> statement-breakpoint

-- Policies permissivas somam (OR) com tenant_isolation: com só o usuário definido,
-- enxerga as próprias memberships; com só o tenant definido, as do tenant.
CREATE POLICY membership_self_select ON memberships FOR SELECT
  USING (user_id = factoria_current_user_id());
--> statement-breakpoint

CREATE POLICY tenant_member_select ON tenants FOR SELECT
  USING (id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = factoria_current_user_id()));
--> statement-breakpoint

-- Mesma função padrão da 0001, agora sem poluir a saída das migrations com NOTICEs
-- ("policy does not exist, skipping") na primeira aplicação.
CREATE OR REPLACE FUNCTION factoria_enable_tenant_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql
SET client_min_messages = warning
AS $$
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
REVOKE ALL ON FUNCTION factoria_enable_tenant_rls(regclass) FROM PUBLIC, factoria_app;
