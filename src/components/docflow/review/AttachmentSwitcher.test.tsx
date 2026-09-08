import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentSwitcher from './AttachmentSwitcher';
import type { RequestAttachment, RequestItem } from '@/api/types';

/**
 * The review workspace's way through several files on one checklist line (H5).
 *
 * Each attachment is its own `/review/:documentId`, so this component's whole
 * job is to say which one is on screen and navigate to the others.
 */

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const attachment = (n: number, state: 'ready' | 'checking' = 'ready'): RequestAttachment => ({
  documentId: `doc-${n}`,
  displayName: `receipt-${n}.pdf`,
  state,
  currentVersion: {
    id: `ver-${n}`,
    versionNo: 1,
    originalFilename: `receipt-${n}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    scanStatus: 'clean',
    available: state === 'ready',
  },
});

const requestWith = (attachments: RequestAttachment[]) =>
  ({ id: 'req-1', title: '2024 receipts', attachments, attachmentCount: attachments.length } as unknown as RequestItem);

const mount = (attachments: RequestAttachment[], current: string) =>
  render(
    <MemoryRouter>
      <AttachmentSwitcher request={requestWith(attachments)} currentDocumentId={current} />
    </MemoryRouter>
  );

describe('the review workspace with several attachments', () => {
  it('names every attachment and says which one is on screen', () => {
    mount([attachment(1), attachment(2), attachment(3)], 'doc-2');

    expect(screen.getByText('receipt-1.pdf')).toBeTruthy();
    expect(screen.getByText('receipt-2.pdf')).toBeTruthy();
    expect(screen.getByText('receipt-3.pdf')).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('moves to the attachment that is clicked', () => {
    mount([attachment(1), attachment(2), attachment(3)], 'doc-1');

    fireEvent.click(screen.getByText('receipt-3.pdf'));
    expect(navigate).toHaveBeenCalledWith('/review/doc-3');
  });

  it('walks forwards and backwards, and stops at the ends', () => {
    mount([attachment(1), attachment(2)], 'doc-1');

    const back = screen.getByLabelText('Previous attachment') as HTMLButtonElement;
    const forward = screen.getByLabelText('Next attachment') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    fireEvent.click(forward);
    expect(navigate).toHaveBeenCalledWith('/review/doc-2');
  });

  it('marks an attachment still being scanned, because it cannot be decided yet', () => {
    mount([attachment(1), attachment(2, 'checking')], 'doc-1');
    expect(screen.getByText('Checking')).toBeTruthy();
  });

  /** Every checklist line that existed before H5 holds exactly one file. */
  it('renders nothing at all for a line with one attachment', () => {
    const { container } = mount([attachment(1)], 'doc-1');
    expect(container.firstChild).toBeNull();
  });
});
