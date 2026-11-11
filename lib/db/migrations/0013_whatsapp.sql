CREATE TABLE "whatsapp_connections" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"instance_name" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"phone" text,
	"notify_orders" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connections_instance_name_unique" UNIQUE("instance_name"),
	CONSTRAINT "whatsapp_connections_status_values" CHECK ("whatsapp_connections"."status" in ('disconnected', 'connecting', 'connected'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Isolamento por restaurante (regra 9): RLS forçado, fail-closed.
SELECT factoria_enable_tenant_rls('whatsapp_connections');
--> statement-breakpoint
REVOKE TRUNCATE ON whatsapp_connections FROM factoria_app;
