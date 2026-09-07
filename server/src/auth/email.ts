/**
 * The canonical form of an email address.
 *
 * `clients.email` keeps the address as the person typed it — that is what an
 * advisor recognises in a list and what invitations are addressed to. Identity
 * questions ("is this the same client?", "how many attempts from this address?")
 * are asked of the canonical form instead, so `Sarah@Example.COM ` and
 * `sarah@example.com` cannot become two clients or two rate-limit buckets.
 *
 * Deliberately conservative: case and surrounding whitespace only. Provider
 * tricks like stripping dots or `+tags` would make two addresses the firm
 * considers different collide, and `clients_email_normalized_key` turns a
 * collision into a refused create.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
