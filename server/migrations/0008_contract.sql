/*
 * C5.4 — the contraction, and the only non-additive migration in the pilot:
 * invariant 12 forbids destructive migrations "before C5.4", and this is C5.4.
 *
 * Everything dropped here was frozen at the C2.1 import and has had no reader in
 * the application since C4.1. Verified against the live database before this was
 * written: no `documents` row had `kind IS NULL` (nothing was still waiting to be
 * imported), no two clients shared a normalised address, `presets` was empty, and
 * every byte under `server/uploads` was checked byte-identical to a clean,
 * published version under DATA_ROOT.
 *
 * The backfill below is hand-added to what drizzle-kit generated, and is the
 * reason this migration is safe anywhere but the box it was written on:
 * `email_normalized` was written only by the legacy importer, so any client
 * created through POST /clients since C2.1 has NULL there and SET NOT NULL would
 * abort. It also makes the unique index mean something — without it every new row
 * would be NULL, and NULLs never collide.
 */
UPDATE "clients" SET "email_normalized" = lower(trim("email")) WHERE "email_normalized" IS NULL;--> statement-breakpoint
ALTER TABLE "presets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "presets" CASCADE;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "email_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_email_normalized_key" ON "clients" USING btree ("email_normalized");--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "size";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "folder";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "storage_path";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "is_requested";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "requested_by_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "requested_at";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "request_frequency";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "due_date";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "has_update_request";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "update_requested_by_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "update_requested_at";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "update_request_description";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "requested_version";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."document_status";--> statement-breakpoint
DROP TYPE "public"."request_frequency";
