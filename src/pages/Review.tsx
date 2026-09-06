import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useClient,
  useDocument,
  useDocumentVersions,
  useEngagements,
  useRequest,
  useShareDocument,
  useUnshareDocument,
} from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '@/components/docflow/icons';
import Modal from '@/components/docflow/Modal';
import MessagesPanel from '@/components/docflow/MessagesPanel';
import DocumentPreview from '@/components/docflow/review/DocumentPreview';
import VersionHistory from '@/components/docflow/review/VersionHistory';
import ReviewActions from '@/components/docflow/review/ReviewActions';
import Organization from '@/components/docflow/review/Organization';

/**
 * The review workspace: the document on the left, everything you need to decide
 * about it on the right.
 *
 * This is the screen a tax season is spent in, so it is built around one
 * motion — read the file, press A or C, move on. The thread is document-scoped,
 * so a question about this statement lives with the statement rather than in a
 * general conversation the client has to scroll.
 */

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'df-warn' },
  submitted: { label: 'Submitted', cls: 'df-info' },
  in_review: { label: 'In review', cls: 'df-info' },
  needs_correction: { label: 'Needs correction', cls: 'df-danger' },
  accepted: { label: 'Accepted', cls: 'df-ok' },
  waived: { label: 'Waived', cls: 'df-plain' },
};

const Review: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: doc, isPending, error } = useDocument(documentId);
  const { data: versions = [] } = useDocumentVersions(documentId);
  const { data: request = null } = useRequest(doc?.requestId ?? undefined);
  const { data: client } = useClient(doc?.clientId);
  const { data: engagements = [] } = useEngagements({ clientId: doc?.clientId });

  const share = useShareDocument();
  const unshare = useUnshareDocument();
  const [confirmShare, setConfirmShare] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  /* Default to what is current; follow it when a new version arrives, unless
     the advisor has deliberately gone back to an older one. */
  const selected = useMemo(() => {
    if (selectedVersionId) return versions.find((v) => v.id === selectedVersionId) ?? null;
    return versions.find((v) => v.isCurrent) ?? versions[0] ?? null;
  }, [versions, selectedVersionId]);

  useEffect(() => {
    if (selectedVersionId && !versions.some((v) => v.id === selectedVersionId)) setSelectedVersionId(null);
  }, [versions, selectedVersionId]);

  if (isPending) {
    return <div className="df-page"><div className="df-empty">Loading…</div></div>;
  }
  if (error || !doc) {
    return (
      <div className="df-page">
        <div className="df-empty">
          That document is not on your file.{' '}
          <button className="df-link" onClick={() => navigate('/clients')}>Back to clients</button>
        </div>
      </div>
    );
  }

  const engagement = engagements.find((e) => e.id === doc.engagementId) ?? null;
  const isDeliverable = doc.kind === 'deliverable';

  const doShare = async () => {
    try {
      await share.mutateAsync(doc.id);
      setConfirmShare(false);
      toast({ title: 'Shared with the client', description: 'It is visible in their portal now.' });
    } catch (err) {
      toast({ title: 'Could not share', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const doUnshare = async () => {
    try {
      await unshare.mutateAsync(doc.id);
      toast({ title: 'No longer shared', description: 'The client can no longer see it.' });
    } catch (err) {
      toast({ title: 'Could not unshare', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div className="df-client-switcher">
          <button
            className="df-icon-btn"
            aria-label="Back"
            onClick={() => navigate(doc.engagementId ? `/engagements/${doc.engagementId}` : `/clients/${doc.clientId}`)}
          >
            <I.ChevronL size={14} />
          </button>
          <div>
            <h1 className="df-client-name">{doc.displayName ?? doc.name}</h1>
            <div className="df-client-meta">
              <button className="df-link" onClick={() => navigate(`/clients/${doc.clientId}`)}>
                {client?.name ?? 'Client'}
              </button>
              {engagement && (
                <>
                  <span className="df-dot-sep" />
                  <button className="df-link" onClick={() => navigate(`/engagements/${engagement.id}`)}>
                    {engagement.title}
                  </button>
                </>
              )}
              {doc.category && (
                <>
                  <span className="df-dot-sep" />
                  <span>{doc.category}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="df-head-actions">
          {isDeliverable && (doc.shared ? <span className="df-pill df-ok">Shared</span> : <span className="df-pill df-plain">Private</span>)}
          {isDeliverable && (
            doc.shared ? (
              <button className="df-btn df-ghost" onClick={doUnshare} disabled={unshare.isPending}>Unshare</button>
            ) : (
              <button
                className="df-btn df-primary"
                onClick={() => setConfirmShare(true)}
                disabled={!selected?.available || share.isPending}
                title={selected?.available ? undefined : 'Wait for the virus check to finish'}
              >
                <I.Send size={13} /> Share with client
              </button>
            )
          )}
        </div>
      </div>

      <div className="df-review">
        <div style={{ minWidth: 0 }}>
          <DocumentPreview documentId={doc.id} version={selected} />
        </div>

        <div className="df-review-rail">
          {request && (
            <div className="df-section">
              <div className="df-section-head">
                <div>
                  <div className="df-section-title">What was asked for</div>
                  <div className="df-section-sub">{request.category ?? 'Checklist item'}</div>
                </div>
                <div className="df-right">
                  <span className={'df-pill ' + (STATUS_PILL[request.status]?.cls ?? 'df-plain')}>
                    {STATUS_PILL[request.status]?.label ?? request.status}
                  </span>
                </div>
              </div>
              <div className="df-section-body">
                <div className="df-name">{request.title}</div>
                {request.instructions && <div className="df-small df-muted" style={{ marginTop: 4 }}>{request.instructions}</div>}
                <div className="df-meta" style={{ marginTop: 6 }}>
                  {request.dueDate ? <>Due {request.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</> : 'No due date'}
                  {request.overdue ? ' · overdue' : ''}
                </div>
                {request.clientResponseKind && request.status !== 'accepted' && request.status !== 'waived' && (
                  <div className="df-note df-note-warn">
                    <strong>The client says they do not have this.</strong>
                    {request.clientResponseNote ? <> “{request.clientResponseNote}”</> : null}
                  </div>
                )}
              </div>
            </div>
          )}

          <ReviewActions document={doc} request={request} version={selected} />

          <VersionHistory
            documentId={doc.id}
            versions={versions}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedVersionId}
          />

          <Organization document={doc} engagements={engagements} />

          <MessagesPanel
            clientId={doc.clientId}
            documentId={doc.id}
            contextDoc={doc.displayName ?? doc.name}
            meKind="provider"
            title="About this document"
            subtitle="Only about this file"
          />
        </div>
      </div>

      <Modal
        open={confirmShare}
        onClose={() => setConfirmShare(false)}
        title="Share with the client?"
        subtitle={doc.displayName ?? doc.name}
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setConfirmShare(false)} disabled={share.isPending}>Keep private</button>
            <button className="df-btn df-primary" onClick={doShare} disabled={share.isPending}>
              {share.isPending ? 'Sharing…' : 'Share it'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>
          The client sees this in their portal straight away and can download it. You can unshare it later, but they may
          already have opened it.
        </div>
      </Modal>
    </div>
  );
};

export default Review;
