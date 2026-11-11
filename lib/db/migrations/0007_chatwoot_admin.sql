-- ════════════════════════════════════════════════════════════════════════════
-- 0007 — Chatwoot: gravações só pelo super admin
--
-- chatwoot_users decide PARA QUEM o app gera login automático (SSO) no Chatwoot.
-- Por isso o app só LÊ essa tabela; criar a ligação passa por função do super admin.
-- Idem para tenants.chatwoot_account_id / chatwoot_error.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON chatwoot_users FROM factoria_app;
--> statement-breakpoint

-- Associa a conta do Chatwoot ao tenant. Nunca troca uma conta já associada por outra.
CREATE OR REPLACE FUNCTION factoria_admin_set_chatwoot_account(p_tenant uuid, p_account bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_atual bigint;
BEGIN
  PERFORM factoria_require_super_admin();
  SELECT chatwoot_account_id INTO v_atual FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant inexistente' USING ERRCODE = '22023'; END IF;
  IF v_atual IS NOT NULL AND v_atual <> p_account THEN
    RAISE EXCEPTION 'tenant já associado a outra conta do Chatwoot' USING ERRCODE = '23505';
  END IF;
  UPDATE tenants SET chatwoot_account_id = p_account, chatwoot_error = NULL WHERE id = p_tenant;
END
$$;
--> statement-breakpoint

-- Registra (ou limpa, com NULL) o último erro de provisionamento, para aparecer no painel.
CREATE OR REPLACE FUNCTION factoria_admin_set_chatwoot_error(p_tenant uuid, p_error text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  UPDATE tenants SET chatwoot_error = left(p_error, 500) WHERE id = p_tenant;
END
$$;
--> statement-breakpoint

-- Liga usuário do SaaS ao usuário do Chatwoot. Nunca repõe uma ligação existente.
CREATE OR REPLACE FUNCTION factoria_admin_link_chatwoot_user(p_user text, p_chatwoot_user bigint)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM factoria_require_super_admin();
  INSERT INTO chatwoot_users (user_id, chatwoot_user_id) VALUES (p_user, p_chatwoot_user)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT chatwoot_user_id INTO v_id FROM chatwoot_users WHERE user_id = p_user;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Lista do super admin agora inclui o estado do Chatwoot.
DROP FUNCTION IF EXISTS factoria_admin_list_tenants();
--> statement-breakpoint
CREATE FUNCTION factoria_admin_list_tenants()
RETURNS TABLE (
  id uuid, slug text, name text, plan text, status text, timezone text, created_at timestamptz,
  owner_user_id text, owner_name text, owner_email text, owner_activated boolean,
  chatwoot_account_id bigint, chatwoot_error text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  RETURN QUERY
    SELECT t.id, t.slug, t.name, t.plan, t.status, t.timezone, t.created_at,
           o.user_id, o.name, o.email, coalesce(o.activated, false),
           t.chatwoot_account_id, t.chatwoot_error
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT m.user_id, u.name, u.email,
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

REVOKE ALL ON FUNCTION factoria_admin_set_chatwoot_account(uuid, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_set_chatwoot_error(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_link_chatwoot_user(text, bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_list_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_set_chatwoot_account(uuid, bigint) TO factoria_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_set_chatwoot_error(uuid, text) TO factoria_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_link_chatwoot_user(text, bigint) TO factoria_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_list_tenants() TO factoria_app;
