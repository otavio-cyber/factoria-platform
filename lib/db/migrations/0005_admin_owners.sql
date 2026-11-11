-- ════════════════════════════════════════════════════════════════════════════
-- 0005 — Super admin enxerga os VÍNCULOS (quem é dono de cada restaurante)
--
-- Para suporte (gerar novo link de ativação, corrigir e-mail do dono), o super admin
-- precisa saber quem administra cada tenant. Libera SÓ a tabela memberships, e só
-- dentro de withSuperAdmin(). Dados de negócio (contatos, conversas, mensagens,
-- reservas) continuam exigindo withTenant().
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY membership_super_admin_select ON memberships FOR SELECT
  USING (coalesce(current_setting('app.is_super_admin', true), '') = 'on');
--> statement-breakpoint

-- Novo formato de retorno (inclui o dono) → precisa recriar a função.
DROP FUNCTION IF EXISTS factoria_admin_list_tenants();
--> statement-breakpoint

CREATE FUNCTION factoria_admin_list_tenants()
RETURNS TABLE (
  id uuid, slug text, name text, plan text, status text, timezone text, created_at timestamptz,
  owner_user_id text, owner_name text, owner_email text, owner_activated boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  RETURN QUERY
    SELECT t.id, t.slug, t.name, t.plan, t.status, t.timezone, t.created_at,
           o.user_id, o.name, o.email, coalesce(o.activated, false)
    FROM tenants t
    LEFT JOIN LATERAL (
      -- dono = primeiro tenant_admin do restaurante
      SELECT m.user_id, u.name, u.email,
             -- ativado = já trocou a senha aleatória inicial (ou já tem sessão)
             ( EXISTS (SELECT 1 FROM account a
                       WHERE a.user_id = u.id AND a.provider_id = 'credential'
                         AND a.updated_at > a.created_at + interval '2 seconds')
               OR EXISTS (SELECT 1 FROM session s WHERE s.user_id = u.id AND s.impersonated_by IS NULL)
             ) AS activated
      FROM memberships m JOIN "user" u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.role = 'tenant_admin'
      ORDER BY m.created_at
      LIMIT 1
    ) o ON true
    ORDER BY t.created_at DESC;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_list_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_list_tenants() TO factoria_app;
