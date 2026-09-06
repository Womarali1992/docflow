CREATE TYPE "public"."document_kind" AS ENUM('client_upload', 'deliverable', 'imported');--> statement-breakpoint
CREATE TYPE "public"."engagement_kind" AS ENUM('individual_tax', 'business_tax', 'other', 'imported');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('requested', 'submitted', 'in_review', 'needs_correction', 'accepted', 'waived');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('accepted', 'needs_correction');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'infected', 'encrypted', 'error');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('individual_tax', 'business_tax', 'custom');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"client_id" uuid,
	"ip" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT false NOT NULL,
	"dump_bytes" integer,
	"file_count" integer,
	"manifest_path" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"scan_detail" text,
	"scanned_at" timestamp with time zone,
	"uploaded_by_kind" "actor_kind" NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "engagement_kind" DEFAULT 'other' NOT NULL,
	"tax_year" integer,
	"status" "engagement_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_kind" "actor_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "template_kind" DEFAULT 'custom' NOT NULL,
	"items" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"category" text,
	"required" boolean DEFAULT true NOT NULL,
	"due_date" timestamp with time zone,
	"status" "request_status" DEFAULT 'requested' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"template_item_key" text,
	"waived_reason" text,
	"waived_at" timestamp with time zone,
	"waived_by_id" uuid,
	"client_response_kind" text,
	"client_response_note" text,
	"client_response_at" timestamp with time zone,
	"imported_from_document_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid,
	"request_id" uuid,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "email_normalized" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "engagement_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "kind" "document_kind";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "shared_by_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_templates" ADD CONSTRAINT "request_templates_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_client_at_idx" ON "audit_log" USING btree ("client_id","at");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_unique" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "engagements_client_idx" ON "engagements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "engagements_provider_idx" ON "engagements" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_kind","user_id");--> statement-breakpoint
CREATE INDEX "request_templates_provider_idx" ON "request_templates" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "requests_provider_status_due_idx" ON "requests" USING btree ("provider_id","status","due_date");--> statement-breakpoint
CREATE INDEX "requests_engagement_idx" ON "requests" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "requests_client_idx" ON "requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "requests_imported_from_idx" ON "requests" USING btree ("imported_from_document_id");--> statement-breakpoint
CREATE INDEX "reviews_document_idx" ON "reviews" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reviews_request_idx" ON "reviews" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_client_engagement_idx" ON "documents" USING btree ("client_id","engagement_id");--> statement-breakpoint
CREATE INDEX "documents_request_idx" ON "documents" USING btree ("request_id");

--> statement-breakpoint
-- Invariant 11: the audit log is append-only. A row-level trigger refuses UPDATE and
-- DELETE outright, so no route, script or console session can quietly rewrite history.
-- TRUNCATE is a statement-level operation and does not fire this, which is deliberate:
-- the test harness truncates between tests, and a restore replaces the whole database.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only_trigger
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
