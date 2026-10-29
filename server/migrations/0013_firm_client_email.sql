/*
 * F7 of the firm book (docs/FIRM-BOOK-PLAN.md): a client's address is unique
 * within a firm, not across the install. The same person may be a client of
 * two firms, and each firm's account is its own.
 *
 *  - The per-firm unique index goes in before the global one comes out, so no
 *    moment exists in which two rows of one firm could share an address.
 *  - A plain index on `email_normalized` stays behind it: sign-in and the
 *    password-reset request look an address up across every firm.
 *
 * No backfill. Every row that satisfied the global rule satisfies this one.
 */
CREATE UNIQUE INDEX "clients_firm_email_normalized_key" ON "clients" USING btree ("firm_id","email_normalized");--> statement-breakpoint
DROP INDEX "clients_email_normalized_key";--> statement-breakpoint
CREATE INDEX "clients_email_normalized_idx" ON "clients" USING btree ("email_normalized");
