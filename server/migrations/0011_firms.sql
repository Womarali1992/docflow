/*
 * F1 of the firm book (docs/FIRM-BOOK-PLAN.md): the expand half, additive only.
 * Nothing is dropped, and nothing the application reads changes meaning.
 *
 * drizzle-kit generated `ADD COLUMN "firm_id" uuid NOT NULL`, which aborts on
 * any table that already has rows. The backfill below is added by hand, the way
 * `0008_contract` did it: each column is added nullable, filled, and only then
 * made NOT NULL.
 *
 *  - One firm per existing advisor, named the way every email sign-off already
 *    falls back: the firm name, or else the advisor's own.
 *  - A firm's id is fresh, never its founder's. If the two were equal, code that
 *    passed a provider id where a firm id belongs would pass every test against
 *    migrated data. `founder_id` carries the mapping and is dropped below.
 *  - Every existing advisor becomes the owner of their firm.
 *  - Every tenant row takes the firm of the advisor in its `provider_id`, and
 *    every client is assigned to that advisor.
 *  - `provider_id` becomes nullable on the seven tenant tables. It is still
 *    written until F3 and is dropped only by F9, on the user's word.
 */
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"founder_id" uuid
);
--> statement-breakpoint
INSERT INTO "firms" ("name", "founder_id", "created_at")
	SELECT coalesce(nullif(trim("firm_name"), ''), "name"), "id", "created_at" FROM "providers";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
UPDATE "providers" SET "firm_id" = f."id", "role" = 'owner' FROM "firms" f WHERE f."founder_id" = "providers"."id";--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "firms" DROP COLUMN "founder_id";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "assigned_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "request_templates" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "firm_id" uuid;--> statement-breakpoint
UPDATE "activities" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "activities"."provider_id";--> statement-breakpoint
UPDATE "clients" SET "firm_id" = p."firm_id", "assigned_provider_id" = p."id" FROM "providers" p WHERE p."id" = "clients"."provider_id";--> statement-breakpoint
UPDATE "documents" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "documents"."provider_id";--> statement-breakpoint
UPDATE "engagements" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "engagements"."provider_id";--> statement-breakpoint
UPDATE "messages" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "messages"."provider_id";--> statement-breakpoint
UPDATE "request_templates" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "request_templates"."provider_id";--> statement-breakpoint
UPDATE "requests" SET "firm_id" = p."firm_id" FROM "providers" p WHERE p."id" = "requests"."provider_id";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "engagements" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "request_templates" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "firm_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "engagements" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "request_templates" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_assigned_provider_id_providers_id_fk" FOREIGN KEY ("assigned_provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_templates" ADD CONSTRAINT "request_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_firm_idx" ON "activities" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "clients_firm_idx" ON "clients" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "clients_assigned_provider_idx" ON "clients" USING btree ("assigned_provider_id");--> statement-breakpoint
CREATE INDEX "documents_firm_idx" ON "documents" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "engagements_firm_idx" ON "engagements" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "messages_firm_idx" ON "messages" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "providers_firm_idx" ON "providers" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "request_templates_firm_idx" ON "request_templates" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "requests_firm_status_due_idx" ON "requests" USING btree ("firm_id","status","due_date");
