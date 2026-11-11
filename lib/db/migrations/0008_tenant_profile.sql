ALTER TABLE "tenants" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_zip" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_street" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_complement" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_district" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_city" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_state" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cnpj_format" CHECK ("tenants"."cnpj" ~ '^[0-9]{14}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_phone_e164" CHECK ("tenants"."phone" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_category_values" CHECK ("tenants"."category" in ('churrascaria','japonesa','pizzaria','lanchonete','hamburgueria','restaurante','marmitaria','bar','cafeteria','doceria','outra'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_zip_format" CHECK ("tenants"."address_zip" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_state_format" CHECK ("tenants"."address_state" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_opening_hours_object" CHECK (jsonb_typeof("tenants"."opening_hours") = 'object');--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════
-- Permissões: o dono edita os dados OPERACIONAIS do próprio restaurante
-- (policy tenant_self_update já limita à linha do tenant da transação).
-- Dados fiscais (legal_name, cnpj) ficam de fora: só pela função do super admin.
-- ════════════════════════════════════════════════════════════════════════════
GRANT UPDATE (phone, category, address_zip, address_street, address_number, address_complement,
              address_district, address_city, address_state, opening_hours) ON tenants TO factoria_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION factoria_admin_set_tenant_fiscal(p_tenant uuid, p_legal_name text, p_cnpj text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM factoria_require_super_admin();
  UPDATE tenants SET legal_name = p_legal_name, cnpj = p_cnpj WHERE id = p_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant inexistente' USING ERRCODE = '22023'; END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION factoria_admin_set_tenant_fiscal(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION factoria_admin_set_tenant_fiscal(uuid, text, text) TO factoria_app;
