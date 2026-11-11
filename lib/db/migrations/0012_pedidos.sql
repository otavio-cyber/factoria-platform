CREATE TABLE "delivery_districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"fee_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_districts_tenant_key_uq" UNIQUE("tenant_id","name_key"),
	CONSTRAINT "delivery_districts_fee_nonneg" CHECK ("delivery_districts"."fee_cents" >= 0),
	CONSTRAINT "delivery_districts_name_len" CHECK (char_length("delivery_districts"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"name" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"notes" text,
	"line_total_cents" integer NOT NULL,
	CONSTRAINT "order_items_qty_range" CHECK ("order_items"."quantity" between 1 and 99),
	CONSTRAINT "order_items_line_total" CHECK ("order_items"."line_total_cents" = "order_items"."unit_price_cents" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"public_token" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"type" text NOT NULL,
	"contact_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"address_zip" text,
	"address_street" text,
	"address_number" text,
	"address_complement" text,
	"address_district" text,
	"address_city" text,
	"address_state" text,
	"address_reference" text,
	"notes" text,
	"payment_method" text NOT NULL,
	"change_for_cents" integer,
	"subtotal_cents" integer NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "orders_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "orders_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "orders_status_values" CHECK ("orders"."status" in ('received','preparing','ready','out_for_delivery','delivered','canceled')),
	CONSTRAINT "orders_type_values" CHECK ("orders"."type" in ('delivery','pickup')),
	CONSTRAINT "orders_payment_values" CHECK ("orders"."payment_method" in ('cash','card','pix')),
	CONSTRAINT "orders_phone_e164" CHECK ("orders"."customer_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "orders_totals" CHECK ("orders"."subtotal_cents" > 0 and "orders"."delivery_fee_cents" >= 0 and "orders"."total_cents" = "orders"."subtotal_cents" + "orders"."delivery_fee_cents"),
	CONSTRAINT "orders_delivery_address" CHECK ("orders"."type" = 'pickup' or ("orders"."address_street" is not null and "orders"."address_number" is not null and "orders"."address_district" is not null))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "orders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "delivery_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "pickup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "min_order_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "delivery_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "prep_time" text;--> statement-breakpoint
ALTER TABLE "delivery_districts" ADD CONSTRAINT "delivery_districts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_same_tenant_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_same_tenant_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_min_order_nonneg" CHECK ("tenants"."min_order_cents" >= 0);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_delivery_fee_nonneg" CHECK ("tenants"."delivery_fee_cents" >= 0);--> statement-breakpoint
-- Isolamento por restaurante (regra 9): RLS forçado, fail-closed.
SELECT factoria_enable_tenant_rls('delivery_districts');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('orders');
--> statement-breakpoint
SELECT factoria_enable_tenant_rls('order_items');
--> statement-breakpoint
REVOKE TRUNCATE ON delivery_districts, orders, order_items FROM factoria_app;
--> statement-breakpoint
-- Pedido não se apaga pelo app (histórico financeiro): cancela-se.
REVOKE DELETE ON orders, order_items FROM factoria_app;
--> statement-breakpoint
-- Itens do pedido não mudam depois de criados (cópia do que o cliente comprou).
REVOKE UPDATE ON order_items FROM factoria_app;
--> statement-breakpoint
-- O dono configura entrega e pedidos (o RLS de tenants limita ao próprio restaurante).
GRANT UPDATE (orders_enabled, delivery_enabled, pickup_enabled, min_order_cents, delivery_fee_cents, prep_time)
  ON tenants TO factoria_app;
