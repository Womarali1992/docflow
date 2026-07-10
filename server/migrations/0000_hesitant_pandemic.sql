CREATE TYPE "public"."activity_type" AS ENUM('document', 'message', 'update');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('provider', 'client');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'reviewed', 'needs_update', 'in_review');--> statement-breakpoint
CREATE TYPE "public"."request_frequency" AS ENUM('daily', 'monthly', 'quarterly', 'yearly', 'one-time');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"client_id" uuid,
	"type" "activity_type" NOT NULL,
	"description" text NOT NULL,
	"actor_kind" "actor_kind",
	"actor_id" uuid,
	"actor_name" text,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"account_id" text NOT NULL,
	"plan" text DEFAULT 'Core',
	"client_since" text,
	"pending_updates" integer DEFAULT 0,
	"unread_messages" integer DEFAULT 0,
	"documents_count" integer DEFAULT 0,
	"last_activity" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"size" text,
	"folder" text DEFAULT 'Documents',
	"url" text,
	"uploaded_by_kind" "actor_kind",
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_requested" boolean DEFAULT false,
	"requested_by_id" uuid,
	"requested_at" timestamp with time zone,
	"description" text,
	"request_frequency" "request_frequency",
	"due_date" timestamp with time zone,
	"has_update_request" boolean DEFAULT false,
	"update_requested_by_id" uuid,
	"update_requested_at" timestamp with time zone,
	"update_request_description" text,
	"requested_version" text,
	"status" "document_status" DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"document_id" uuid,
	"sender_kind" "actor_kind" NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_name" text NOT NULL,
	"content" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bins" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"firm_name" text,
	"role" text DEFAULT 'advisor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_provider_idx" ON "activities" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "clients_provider_idx" ON "clients" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "documents_client_idx" ON "documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "documents_provider_idx" ON "documents" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "messages_client_idx" ON "messages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "messages_doc_idx" ON "messages" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "presets_provider_idx" ON "presets" USING btree ("provider_id");