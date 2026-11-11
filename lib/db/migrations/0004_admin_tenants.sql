-- ════════════════════════════════════════════════════════════════════════════
-- 0004 — Operações do super admin sobre tenants (onboarding)
--
-- O app (factoria_app) NÃO tem INSERT em tenants. Criar/listar tenants passa por
-- funções SECURITY DEFINER que só funcionam dentro de withSuperAdmin(), que define
-- app.is_super_admin = 'on' na transação. O app só chama withSuperAdmin() depois de
-- requireSuperAdmin() validar a sessão (lib/auth). Chamada fora desse contexto → erro.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION factoria_require_super_admin() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce(current_setting('app.is_super_admin', true), '') <> 'on' THEN
    RAISE EXCEPTION 'operação restrita ao super admin' USING ERRCODE = '42501';
  END IF;
END
$$;
--> statement-breakpoint

-- Cria um tenant. Valida fuso horário contra o catálogo do Postgres.
-- (Formato do slug: CHECK da tabela. Slugs reservados: validados no app.)
CREATE OR REPLACE FUNCTION factoria_admin_create_tenant(p_slug text, p_name text, p_timezone text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM factoria_require_super_admin();
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'fuso horário inválido: %', p_timezone USING ERRCODE = '22023';
  END IF;
  INSERT INTO tenants (slug, name, timezone)
  VALUES (lower(trim(p_slug)), trim(p_name), p_timezone)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Lista todos os tenants (visão do super admin). Só metadados, nenhum dado de negócio.
CREATE OR REPLACE FUNCTION factoria_admin_list_tenants()
RETURNS TABLE (id uuid, slug text, name text, plan text, status text, timezone text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  RETURN QUERY
    SELECT t.id, t.slug, t.name, t.plan, t.status, t.timezone, t.created_at
    FROM tenants t ORDER BY t.created_at DESC;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION factoria_admin_create_tenant(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_list_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_create_tenant(text, text, text) TO factoria_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_list_tenants() TO factoria_app;
