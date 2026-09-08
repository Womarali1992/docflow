import React, { useEffect, useState } from 'react';
import type { Document, RequestItem, VersionWithReviews } from '@/api/types';
import {
  useAcceptDocument,
  useAcceptRequest,
  useRefreshDocument,
  useRequestCorrection,
  useRequestDocumentCorrection,
  useWaiveRequest,
} from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { getErrorMessage, staleVersion } from '@/utils/errors';
import { I } from '../icons';
import ReasonDialog from '../ReasonDialog';

/**
 * The decision, and the two keys that make a stack of documents bearable:
 * **A** accepts, **C** asks for a correction.
 *
 * A decision is always about a *version*: the one on screen. Accepting while
 * looking at v1 when v2 has arrived would be a decision about something the
 * advisor is not reading, so the version being previewed is the version sent to
 * the server — and the server refuses it if it does not belong to this request.
 *
 * Where the decision is recorded depends on what is being reviewed: a checklist
 * answer moves its *request* (which is what the client sees), while an ad-hoc
 * upload with no request behind it is decided on the document itself.
 *
 * H2 made that promise the server's rather than this component's. A decision
 * about a version that is no longer the current one comes back 409
 * `stale_version` — a newer file landed while the advisor was reading — and the
 * only useful answer is to go and get it. Hence Refresh, and buttons that stay
 * disabled until the refetch has landed: deciding twice in a row about a screen
 * that is still catching up is exactly the mistake being prevented.
 */
interface Props {
  document: Document;
  request: RequestItem | null;
  version: VersionWithReviews | null;
}

const ReviewActions: React.FC<Props> = ({ document: doc, request, version }) => {
  const { toast } = useToast();
  const acceptRequest = useAcceptRequest();
  const correctRequest = useRequestCorrection();
  const waiveRequest = useWaiveRequest();
  const acceptDocument = useAcceptDocument();
  const correctDocument = useRequestDocumentCorrection();

  const refreshDocument = useRefreshDocument();

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** Fetch what the server actually has, and keep the buttons off until it lands. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshDocument(doc.id, request?.id ?? null);
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * A refused decision. A stale version is not a failure the advisor caused, so
   * it reads as news plus a way out rather than as an error.
   */
  const refused = (err: unknown, fallbackTitle: string): boolean => {
    const stale = staleVersion(err);
    if (!stale) {
      toast({ title: fallbackTitle, description: getErrorMessage(err), variant: 'destructive' });
      return false;
    }
    toast({
      title: stale.currentVersionId
        ? 'A newer file arrived while you were looking'
        : 'The newest file is still being checked',
      description: getErrorMessage(err),
      action: (
        <ToastAction altText="Refresh this document" onClick={() => void refresh()}>
          Refresh
        </ToastAction>
      ),
    });
    return true;
  };

  /**
   * What this decision is about (H5).
   *
   * A checklist line holds any number of attachments and is accepted as a
   * whole, so the decision names every attachment's current version. The one
   * on screen is named by the version the advisor is actually *reading* rather
   * than by whatever is current — so going back to v1 and pressing A still gets
   * the 409 it always did, instead of silently accepting v2.
   */
  const attachments = request?.attachments ?? [];
  const versionIds = attachments
    .map((a) => (a.documentId === doc.id ? version?.id ?? a.currentVersion?.id : a.currentVersion?.id))
    .filter((id): id is string => Boolean(id));
  const someChecking = attachments.some((a) => a.state === 'checking');

  const settled = request ? request.status === 'accepted' || request.status === 'waived' : false;
  const nothingToDecide = !version && !request;
  const busy =
    refreshing ||
    acceptRequest.isPending || correctRequest.isPending || waiveRequest.isPending ||
    acceptDocument.isPending || correctDocument.isPending;

  /* A deliverable is the advisor's own material: there is nothing to review. */
  const reviewable = doc.kind !== 'deliverable' && !nothingToDecide;
  /* Every attachment has to be readable: the server refuses a decision that
     cannot name one of them, and a button that always fails is worse than a
     disabled one. */
  const canDecide = reviewable && Boolean(version) && !settled && !someChecking;

  const accept = async () => {
    if (!canDecide) return;
    try {
      if (request) await acceptRequest.mutateAsync({ id: request.id, versionIds });
      else await acceptDocument.mutateAsync({ id: doc.id, versionId: version!.id });
      toast({ title: 'Accepted', description: doc.displayName ?? doc.name });
    } catch (err) {
      refused(err, 'Could not accept');
    }
  };

  const correct = async (note: string) => {
    try {
      if (request) await correctRequest.mutateAsync({ id: request.id, note, versionIds });
      else await correctDocument.mutateAsync({ id: doc.id, note, versionId: version!.id });
    } catch (err) {
      // Rethrown so the dialog stays open with the note still typed in it — the
      // note is worth keeping even though the version it was about has moved.
      refused(err, 'Could not send it back');
      throw err;
    }
    toast({ title: 'Sent back for correction', description: 'The client sees your note in their portal.' });
  };

  // A and C, only when the keyboard is not in a field and no dialog is open.
  // Deliberately re-bound on every render rather than memoised: the handler has
  // to see the version currently on screen, and one keydown listener is cheap.
  useEffect(() => {
    if (!canDecide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (correctionOpen || waiveOpen) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void accept();
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCorrectionOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (doc.kind === 'deliverable') return null;

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Decision</div>
          <div className="df-section-sub">
            {!version ? (
              'Nothing submitted yet'
            ) : attachments.length > 1 ? (
              <>About all {attachments.length} files on this item</>
            ) : (
              <>About v{version.versionNo}{version.isCurrent ? '' : ' (not the current version)'}</>
            )}
          </div>
        </div>
      </div>
      <div className="df-section-body">
        {settled && request && (
          <div className="df-note">
            This item is {request.status === 'accepted' ? 'accepted' : 'waived'}. Reopen it from the checklist to decide again.
          </div>
        )}
        {!version && (
          <div className="df-note">There is nothing to decide until the client uploads something.</div>
        )}
        {version && !version.available && (
          <div className="df-note df-note-warn">
            You can decide once the virus check has passed — the file cannot be opened before then.
          </div>
        )}
        {version?.available && someChecking && (
          <div className="df-note df-note-warn">
            Another file on this item is still being checked. Deciding covers every file, so it has to wait for that one.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="df-btn df-primary" onClick={accept} disabled={!canDecide || busy}>
            <I.Check size={13} /> Accept <span className="df-kbd">A</span>
          </button>
          <button className="df-btn" onClick={() => setCorrectionOpen(true)} disabled={!canDecide || busy}>
            Request correction <span className="df-kbd">C</span>
          </button>
          {request && !settled && (
            <button className="df-btn df-ghost" onClick={() => setWaiveOpen(true)} disabled={busy}>
              Waive
            </button>
          )}
        </div>
      </div>

      <ReasonDialog
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        title="Ask for a correction"
        subtitle={doc.displayName ?? doc.name}
        label="What needs correcting?"
        help="The client sees this note. Say what is wrong and what to send instead."
        placeholder="The statement is missing page 2 — please send the full PDF."
        confirmLabel="Send back for correction"
        onConfirm={correct}
      />

      {request && (
        <ReasonDialog
          open={waiveOpen}
          onClose={() => setWaiveOpen(false)}
          title="Waive this item"
          subtitle={request.title}
          label="Why is this not needed?"
          help="This stays on the file. A year from now it has to answer “why isn’t this on the list?”."
          placeholder="Client had no brokerage account in 2026."
          confirmLabel="Waive item"
          onConfirm={(reason) => waiveRequest.mutateAsync({ id: request.id, reason })}
        />
      )}
    </div>
  );
};

export default ReviewActions;
