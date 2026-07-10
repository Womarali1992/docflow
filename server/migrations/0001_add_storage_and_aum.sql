ALTER TABLE "clients" ADD COLUMN "aum" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size_bytes" integer;