CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"email" "citext",
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_tenant_phone_uq" UNIQUE("tenant_id","phone"),
	CONSTRAINT "contacts_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "contacts_phone_e164" CHECK ("contacts"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"chatwoot_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'tenant_operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_uq" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_values" CHECK ("memberships"."role" in ('tenant_admin','tenant_operator'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"content" text,
	"media" jsonb,
	"external_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tenant_external_uq" UNIQUE("tenant_id","external_id"),
	CONSTRAINT "messages_direction_values" CHECK ("messages"."direction" in ('in','out')),
	CONSTRAINT "messages_has_body" CHECK ("messages"."content" is not null or "messages"."media" is not null)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"party_size" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"confirmation_sent_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_party_size_positive" CHECK ("reservations"."party_size" > 0),
	CONSTRAINT "reservations_status_values" CHECK ("reservations"."status" in ('confirmed','seated','canceled','no_show'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "tenants_status_values" CHECK ("tenants"."status" in ('active','suspended','canceled'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_same_tenant_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_same_tenant_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contact_same_tenant_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_tags_gin" ON "contacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "contacts_name_trgm" ON "contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "conversations_tenant_status_idx" ON "conversations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_sent_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX "reservations_tenant_starts_idx" ON "reservations" USING btree ("tenant_id","starts_at");