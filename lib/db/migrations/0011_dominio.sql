ALTER TABLE "tenants" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_custom_domain_format" CHECK ("tenants"."custom_domain" ~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$');--> statement-breakpoint

-- Vitrine em domínio próprio: o proxy descobre o restaurante pelo Host (sem tenant na transação).
-- Só devolve o slug de restaurante ATIVO; nada além disso.
CREATE OR REPLACE FUNCTION factoria_resolve_domain(p_host text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT slug FROM tenants WHERE custom_domain = lower(p_host) AND status = 'active' LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_resolve_domain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_resolve_domain(text) TO factoria_app;
--> statement-breakpoint

-- Definir/remover o domínio: só a equipe Factoria (o app não tem UPDATE nessa coluna).
CREATE OR REPLACE FUNCTION factoria_admin_set_custom_domain(p_tenant uuid, p_domain text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  UPDATE tenants SET custom_domain = nullif(lower(trim(p_domain)), '') WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant inexistente' USING ERRCODE = '22023'; END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_set_custom_domain(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_set_custom_domain(uuid, text) TO factoria_app;
