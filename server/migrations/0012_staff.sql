/*
 * F4 of the firm book (docs/FIRM-BOOK-PLAN.md): an owner invites advisors into
 * the firm. Additive only.
 *
 *  - `providers.password_hash` becomes nullable: an invited advisor exists from
 *    the moment they are added and has no password until they accept the link.
 *    `verifyPassword` already refuses a null hash, so such an account cannot
 *    sign in, and nothing assigns them a client or tells them about one.
 *  - `staff_invitations` follows the client invitations' rules exactly (sha256
 *    of the token, single use, 7 days), in a table of its own so the client
 *    path is not touched.
 */
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "providers" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_invitations_provider_idx" ON "staff_invitations" USING btree ("provider_id");