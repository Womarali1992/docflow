/**
 * /api/auth/mfa — second factor for every account (plan: API surface → Auth & sessions).
 *
 * Reachable in any session stage (the pre-auth stages exist for these routes);
 * `verify` and `enroll/confirm` move the session to `active`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticateAnyStage } from '../middleware/auth.js';
import { auditRequest } from '../db/audit.js';
import { setSessionStage } from '../auth/sessions.js';
import {
  beginEnrollment,
  completeEnrollment,
  consumeRecoveryCode,
  consumeTotp,
  countUnusedRecoveryCodes,
  getMfa,
  isEnrolled,
  regenerateRecoveryCodes,
} from '../auth/mfa.js';
import { mfaVerifyLimiter } from '../security/limits.js';

const router = Router();

router.use(authenticateAnyStage);

const codeSchema = z.object({ code: z.string().min(1).max(32) });
const verifySchema = z.union([codeSchema, z.object({ recoveryCode: z.string().min(1).max(32) })]);

const invalidCode = { error: 'That code is not valid. Check your authenticator and try again.', code: 'invalid_code' };

/* Second step of login: a TOTP code or one recovery code. */
router.post('/verify', mfaVerifyLimiter, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const auth = req.auth!;
  const session = req.session!;

  const mfa = await getMfa(auth.kind, auth.sub);
  if (!isEnrolled(mfa)) {
    return res.status(409).json({ error: 'Set up two-step verification first', code: 'not_enrolled', stage: 'mfa_enroll' });
  }

  if ('code' in parsed.data) {
    const result = await consumeTotp(mfa, parsed.data.code);
    if (result !== 'ok') return res.status(401).json(invalidCode);
  } else {
    const ok = await consumeRecoveryCode(auth.kind, auth.sub, parsed.data.recoveryCode);
    if (!ok) return res.status(401).json({ error: 'That recovery code is not valid or was already used.', code: 'invalid_code' });
  }

  if (session.stage !== 'active') await setSessionStage(session.id, 'active');
  const recoveryCodesLeft = await countUnusedRecoveryCodes(auth.kind, auth.sub);
  res.json({ stage: 'active', recoveryCodesLeft });
});

/* Start enrollment: a fresh secret (replaces an unconfirmed one), the otpauth URL and a QR code. */
router.post('/enroll', async (req, res) => {
  const auth = req.auth!;
  const started = await beginEnrollment(auth.kind, auth.sub, auth.email);
  if (!started) {
    return res.status(409).json({ error: 'Two-step verification is already set up. Ask your advisor or administrator to reset it.', code: 'already_enrolled' });
  }
  res.json({ ...started, issuer: process.env.MFA_ISSUER || 'DocFlow', account: auth.email });
});

/* Prove the authenticator works, then activate the session and hand out the recovery codes once. */
router.post('/enroll/confirm', mfaVerifyLimiter, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const auth = req.auth!;
  const session = req.session!;

  const mfa = await getMfa(auth.kind, auth.sub);
  if (!mfa) return res.status(409).json({ error: 'Start enrollment first', code: 'not_started' });
  if (isEnrolled(mfa)) return res.status(409).json({ error: 'Two-step verification is already set up.', code: 'already_enrolled' });

  const result = await consumeTotp(mfa, parsed.data.code);
  if (result !== 'ok') return res.status(401).json(invalidCode);

  const recoveryCodes = await completeEnrollment(mfa);
  await auditRequest(req, {
    action: 'auth.mfa_enrolled',
    targetType: req.auth!.kind,
    targetId: req.auth!.sub,
    meta: { recoveryCodes: recoveryCodes.length },
  });
  await setSessionStage(session.id, 'active');
  res.json({ stage: 'active', recoveryCodes });
});

/* New recovery codes; needs a fresh authenticator code and an active session. */
router.post('/recovery-codes', mfaVerifyLimiter, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
  const auth = req.auth!;
  const session = req.session!;
  if (session.stage !== 'active') {
    return res.status(403).json({ error: 'Finish signing in first', code: 'mfa_required', stage: session.stage });
  }

  const mfa = await getMfa(auth.kind, auth.sub);
  if (!isEnrolled(mfa)) return res.status(409).json({ error: 'Set up two-step verification first', code: 'not_enrolled' });

  const result = await consumeTotp(mfa, parsed.data.code);
  if (result !== 'ok') return res.status(401).json(invalidCode);

  const recoveryCodes = await regenerateRecoveryCodes(auth.kind, auth.sub);
  res.json({ recoveryCodes });
});

/* Where the caller stands: enrolled or not, how many recovery codes remain. */
router.get('/status', async (req, res) => {
  const auth = req.auth!;
  const mfa = await getMfa(auth.kind, auth.sub);
  const enrolled = isEnrolled(mfa);
  res.json({
    stage: req.session!.stage,
    enrolled,
    enrolledAt: enrolled ? mfa.enrolledAt : null,
    recoveryCodesLeft: enrolled ? await countUnusedRecoveryCodes(auth.kind, auth.sub) : 0,
  });
});

export default router;
