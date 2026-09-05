CREATE TYPE "public"."session_stage" AS ENUM('preauth', 'mfa_enroll', 'active');--> statement-breakpoint
CREATE TABLE "mfa_totp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_kind" "actor_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_enc" text NOT NULL,
	"enrolled_at" timestamp with time zone,
	"last_used_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_kind" "actor_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "stage" "session_stage" DEFAULT 'preauth' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_totp_user_unique" ON "mfa_totp" USING btree ("user_kind","user_id");--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_kind","user_id");