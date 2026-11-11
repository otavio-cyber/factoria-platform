ALTER TABLE "tenants" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cover_key" text;--> statement-breakpoint
GRANT UPDATE (logo_key, cover_key) ON tenants TO factoria_app;
