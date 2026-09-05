#!/usr/bin/env node
/**
 * Prints the authenticator code for a TOTP secret, the way a phone app would
 * show it. For the seeded development accounts (`npm run db:seed` prints their
 * secret) and for the runbook's "does the clock agree" check.
 *
 *   npm run totp -- <base32 secret>
 */
import { authenticator } from 'otplib';

const secret = process.argv[2];
if (!secret) {
  console.error('usage: npm run totp -- <base32 secret>');
  process.exit(2);
}

authenticator.options = { step: 30, window: 1 };
const code = authenticator.generate(secret);
const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${code}  (valid for ${secondsLeft}s)`);
