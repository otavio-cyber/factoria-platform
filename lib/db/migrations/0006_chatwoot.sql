CREATE TABLE "chatwoot_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chatwoot_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatwoot_users_chatwoot_user_id_unique" UNIQUE("chatwoot_user_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chatwoot_account_id" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chatwoot_error" text;--> statement-breakpoint
ALTER TABLE "chatwoot_users" ADD CONSTRAINT "chatwoot_users_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_chatwoot_account_id_unique" UNIQUE("chatwoot_account_id");