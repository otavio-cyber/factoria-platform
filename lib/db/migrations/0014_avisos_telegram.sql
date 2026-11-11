CREATE TABLE "order_alerts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"telegram_chat_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_alerts_chat_id_format" CHECK ("order_alerts"."telegram_chat_id" is null or "order_alerts"."telegram_chat_id" ~ '^-?[0-9]{5,20}$'),
	CONSTRAINT "order_alerts_enabled_needs_chat" CHECK (not "order_alerts"."enabled" or "order_alerts"."telegram_chat_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "order_alerts" ADD CONSTRAINT "order_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Isolamento por restaurante (regra 9): RLS forçado, fail-closed.
SELECT factoria_enable_tenant_rls('order_alerts');
--> statement-breakpoint
REVOKE TRUNCATE ON order_alerts FROM factoria_app;
