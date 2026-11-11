CREATE TABLE "delivery_fee_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_m" integer NOT NULL,
	"to_m" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"return_fee_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_fee_bands_tenant_to_uq" UNIQUE("tenant_id","to_m"),
	CONSTRAINT "delivery_fee_bands_range" CHECK ("delivery_fee_bands"."from_m" >= 0 and "delivery_fee_bands"."to_m" > "delivery_fee_bands"."from_m" and "delivery_fee_bands"."to_m" <= 200000),
	CONSTRAINT "delivery_fee_bands_fees" CHECK ("delivery_fee_bands"."fee_cents" >= 0 and "delivery_fee_bands"."return_fee_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_totals";--> statement-breakpoint
ALTER TABLE "delivery_districts" ALTER COLUMN "fee_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "delivery_districts" ADD COLUMN "distance_m" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fee_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_distance_m" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "unknown_district_policy" text DEFAULT 'confirm' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_fee_bands" ADD CONSTRAINT "delivery_fee_bands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_districts" ADD CONSTRAINT "delivery_districts_distance_range" CHECK ("delivery_districts"."distance_m" is null or "delivery_districts"."distance_m" between 0 and 200000);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals" CHECK ("orders"."subtotal_cents" > 0 and "orders"."delivery_fee_cents" >= 0 and "orders"."return_fee_cents" >= 0 and "orders"."total_cents" = "orders"."subtotal_cents" + "orders"."delivery_fee_cents" + "orders"."return_fee_cents");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_unknown_district_policy" CHECK ("tenants"."unknown_district_policy" in ('confirm','block'));--> statement-breakpoint
-- Isolamento por restaurante (regra 9): RLS forçado, fail-closed.
SELECT factoria_enable_tenant_rls('delivery_fee_bands');
--> statement-breakpoint
REVOKE TRUNCATE ON delivery_fee_bands FROM factoria_app;
--> statement-breakpoint
-- O dono escolhe o que fazer com bairro sem distância (o RLS de tenants limita ao próprio restaurante).
GRANT UPDATE (unknown_district_policy) ON tenants TO factoria_app;
