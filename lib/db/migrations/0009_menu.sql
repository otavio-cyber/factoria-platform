CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_categories_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "menu_categories_name_len" CHECK (char_length("menu_categories"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"promo_price_cents" integer,
	"serves" integer,
	"image_key" text,
	"featured" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_items_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "menu_items_name_len" CHECK (char_length("menu_items"."name") between 1 and 100),
	CONSTRAINT "menu_items_price_positive" CHECK ("menu_items"."price_cents" > 0),
	CONSTRAINT "menu_items_promo_lower" CHECK ("menu_items"."promo_price_cents" is null or ("menu_items"."promo_price_cents" > 0 and "menu_items"."promo_price_cents" < "menu_items"."price_cents")),
	CONSTRAINT "menu_items_serves_range" CHECK ("menu_items"."serves" is null or "menu_items"."serves" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_same_tenant_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."menu_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_categories_tenant_position_idx" ON "menu_categories" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "menu_items_category_position_idx" ON "menu_items" USING btree ("category_id","position");--> statement-breakpoint
-- Isolamento por restaurante: RLS forçado, fail-closed (regra 9 de docs/DECISOES.md).
SELECT factoria_enable_tenant_rls('menu_categories');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('menu_items');
--> statement-breakpoint
REVOKE TRUNCATE ON menu_categories, menu_items FROM factoria_app;
