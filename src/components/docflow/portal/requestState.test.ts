import { describe, expect, it } from 'vitest';
import { clientRequestState } from './requestState';
import type { RequestAttachment, RequestItem } from '@/api/types';

/**
 * What a checklist line says to the *client* when it holds several files (H5).
 *
 * The distinction this function exists for — "submitted" versus "received,
 * being checked" — gets harder with six attachments, because the honest answer
 * depends on all of them. A line with five checked files and one still scanning
 * is not readable by the accountant yet, so it is not "submitted" yet either.
 */

const attachment = (n: number, state: 'ready' | 'checking'): RequestAttachment => ({
  documentId: `doc-${n}`,
  displayName: `receipt-${n}.pdf`,
  state,
  currentVersion: {
    id: `ver-${n}`,
    versionNo: 1,
    originalFilename: `receipt-${n}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    scanStatus: state === 'ready' ? 'clean' : 'pending',
    available: state === 'ready',
    createdAt: new Date('2026-09-01T10:00:00Z'),
  },
});

const submitted = { status: 'submitted', overdue: false } as unknown as RequestItem;

describe('what the client is told about a line with several files', () => {
  it('says submitted once every attachment has been checked', () => {
    const view = clientRequestState(submitted, [attachment(1, 'ready'), attachment(2, 'ready')]);
    expect(view.state).toBe('submitted');
    expect(view.label).toBe('Submitted');
  });

  it('says how many are still being checked when some are', () => {
    const view = clientRequestState(submitted, [
      attachment(1, 'ready'),
      attachment(2, 'checking'),
      attachment(3, 'checking'),
    ]);
    expect(view.state).toBe('checking');
    expect(view.note).toContain('2 of 3');
  });

  /** One file is the shape every line had before H5, and keeps its own sentence. */
  it('keeps the singular wording for one attachment', () => {
    const view = clientRequestState(submitted, [attachment(1, 'checking')]);
    expect(view.state).toBe('checking');
    expect(view.note).toContain('Your file is with your accountant');
    expect(view.note).not.toContain('1 of 1');
  });

  it('is unmoved by attachments once the advisor has decided', () => {
    const accepted = { status: 'accepted', overdue: false } as unknown as RequestItem;
    expect(clientRequestState(accepted, [attachment(1, 'checking')]).state).toBe('accepted');
  });

  it('still answers for a line nobody has sent anything for', () => {
    const requested = { status: 'requested', overdue: false } as unknown as RequestItem;
    expect(clientRequestState(requested, []).state).toBe('waiting_on_you');
  });
});
