/*
 * F9 of the firm book (docs/FIRM-BOOK-PLAN.md): the contraction, on the user's
 * word (2026-10-29). Destructive, so a fresh backup was taken first.
 *
 * Since F3 the firm is the tenant: nothing in the application writes or reads
 * `provider_id` on the seven tenant tables, and every reader of
 * `providers.firm_name` moved to `firms.name` in F2. Dropping them also removes
 * seven `ON DELETE CASCADE` paths through which deleting one advisor row would
 * have deleted the firm's clients and files with it.
 *
 * Checked against the dev database before this was written: every tenant row
 * has a `firm_id` (NOT NULL since `0011_firms`), and no reader is left in `src`
 * (the schema no longer has the columns, and the code typechecks).
 *
 * The guard below is hand-added to what drizzle-kit generated. `0011` filled
 * `firm_id` from each row's `provider_id`; if any row now sits in a different
 * firm from the advisor it names, something wrote it by another path, and this
 * migration stops rather than drop the only other record of where it belonged.
 * `staff_invitations.provider_id` is the invitee, not a tenant, and stays.
 */
DO $$
DECLARE
  t text;
  n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'engagements', 'requests', 'documents', 'messages', 'activities', 'request_templates'] LOOP
    EXECUTE format('SELECT count(*) FROM %I x JOIN providers p ON p.id = x.provider_id WHERE p.firm_id <> x.firm_id', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '0014: % row(s) of % sit in another firm than their provider_id; not dropping it', n, t;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "engagements" DROP CONSTRAINT "engagements_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "request_templates" DROP CONSTRAINT "request_templates_provider_id_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_provider_id_providers_id_fk";
--> statement-breakpoint
DROP INDEX "activities_provider_idx";--> statement-breakpoint
DROP INDEX "clients_provider_idx";--> statement-breakpoint
DROP INDEX "documents_provider_idx";--> statement-breakpoint
DROP INDEX "engagements_provider_idx";--> statement-breakpoint
DROP INDEX "request_templates_provider_idx";--> statement-breakpoint
DROP INDEX "requests_provider_status_due_idx";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "engagements" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "providers" DROP COLUMN "firm_name";--> statement-breakpoint
ALTER TABLE "request_templates" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "requests" DROP COLUMN "provider_id";
