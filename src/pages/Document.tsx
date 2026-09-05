import React, { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useClients } from '@/context/ClientsContext';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/api/client';
import { getErrorMessage } from '@/utils/errors';
import { useToast } from '@/hooks/use-toast';
import { I } from '@/components/docflow/icons';
import MessagesPanel from '@/components/docflow/MessagesPanel';

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  pending:      { label: 'Pending',          cls: 'df-warn' },
  reviewed:     { label: 'Reviewed',         cls: 'df-ok' },
  needs_update: { label: 'Update requested', cls: 'df-danger' },
  in_review:    { label: 'In review',        cls: 'df-info' },
};

const DocumentPage = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const { documents, fulfillRequest, patchDocument } = useDocumentsStore();
  const { clients } = useClients();
  const { me } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  const doc = documents.find(d => d.id === documentId);
  const client = doc?.clientId ? clients.find(c => c.id === doc.clientId) : undefined;

  if (!doc) {
    return (
      <div className="df-page">
        <div className="df-section">
          <div className="df-section-head">
            <div className="df-section-title">Document not found</div>
          </div>
          <div className="df-section-body">
            <div className="df-empty">
              We couldn't find that document.{' '}
              <Link to="/overview" className="df-link">Return to Calendar</Link>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isRequested = !!doc.isRequested;
  const isDeliverable = doc.folder === 'Reports' && !doc.isRequested;
  const providerName = me?.name ?? '—';
  const uploadedByName = doc.uploadedByKind === 'client' ? (client?.name ?? 'Client') : providerName;
  const statusPill = doc.hasUpdateRequest ? STATUS_PILL.needs_update : (doc.status ? STATUS_PILL[doc.status] : null);

  const onPickFile = () => fileInputRef.current?.click();

  const doFulfill = async (file: File) => {
    setBusy(true);
    try {
      await fulfillRequest(doc.id, file);
      toast({ title: 'Uploaded', description: `${file.name} attached${isRequested ? ' — request fulfilled' : ''}.` });
    } catch (e) {
      toast({ title: 'Upload failed', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const markReviewed = async () => {
    setBusy(true);
    try {
      await patchDocument(doc.id, { status: 'reviewed', hasUpdateRequest: false });
      toast({ title: 'Marked reviewed', description: doc.name });
    } catch (e) {
      toast({ title: 'Could not update', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const scrollToMessages = () => messagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <div className="df-page">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doFulfill(f); e.currentTarget.value = ''; }}
      />

      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">{doc.name}</h1>
          <div className="df-client-meta">
            <span className="df-mono">{doc.id}</span>
            <span className="df-dot-sep" />
            <span>{doc.folder}</span>
            {client && (
              <>
                <span className="df-dot-sep" />
                <span>
                  Client: <Link className="df-link" to={`/clients/${client.id}`}>{client.name}</Link>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="df-head-actions">
          {doc.hasFile && (
            <a href={api.documents.downloadUrl(doc.id, { attachment: true })} className="df-btn df-ghost">
              <I.Download size={13} /> Download
            </a>
          )}
          <button className="df-btn" onClick={scrollToMessages}><I.Msg size={13} /> Message</button>
          {isRequested
            ? <button className="df-btn df-primary" disabled={busy} onClick={onPickFile}><I.Upload size={13} /> Upload &amp; fulfill</button>
            : <button className="df-btn df-primary" disabled={busy} onClick={markReviewed}><I.Check size={13} /> Mark reviewed</button>}
        </div>
      </div>

      <div className="df-two-col">
        <div style={{ minWidth: 0 }}>
          <div className="df-section">
            <div className="df-section-head">
              <div>
                <div className="df-section-title">Details</div>
                <div className="df-section-sub">Document metadata</div>
              </div>
              <div className="df-right">
                {isRequested && <span className="df-pill df-warn">Requested</span>}
                {isDeliverable && <span className="df-pill df-accent">Deliverable</span>}
                {statusPill && !isRequested && <span className={'df-pill ' + statusPill.cls}>{statusPill.label}</span>}
              </div>
            </div>
            <div className="df-section-body">
              <dl className="df-dl">
                <dt>Folder</dt>
                <dd>{doc.folder}</dd>

                <dt>Type</dt>
                <dd>{doc.type || '—'}</dd>

                <dt>Size</dt>
                <dd className="df-mono">{doc.size || '—'}</dd>

                <dt>{isRequested ? 'Requested' : 'Uploaded'}</dt>
                <dd className="df-mono">
                  {(isRequested ? doc.requestedAt : doc.uploadedAt)?.toLocaleString() || '—'}
                  {isRequested
                    ? <> · by {providerName}</>
                    : (doc.hasFile ? <> · by {uploadedByName}</> : null)}
                </dd>

                {doc.requestFrequency && (
                  <>
                    <dt>Cadence</dt>
                    <dd><span className="df-pill df-accent">{doc.requestFrequency}</span></dd>
                  </>
                )}

                {doc.dueDate && (
                  <>
                    <dt>Due date</dt>
                    <dd className="df-mono">{doc.dueDate.toLocaleDateString()}</dd>
                  </>
                )}

                {doc.description && (
                  <>
                    <dt>Description</dt>
                    <dd>{doc.description}</dd>
                  </>
                )}

                {doc.hasUpdateRequest && (
                  <>
                    <dt>Update request</dt>
                    <dd>
                      {doc.updateRequestDescription || 'Update requested'}
                      {doc.updateRequestedAt && <div className="df-meta">by {providerName} · {doc.updateRequestedAt.toLocaleDateString()}</div>}
                      {doc.requestedVersion && <div className="df-meta">Version: {doc.requestedVersion}</div>}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>

        {client && (
          <MessagesPanel
            ref={messagesRef}
            clientId={client.id}
            documentId={doc.id}
            contextDoc={doc.name}
            meKind="provider"
            subtitle="Document thread"
          />
        )}
      </div>
    </div>
  );
};

export default DocumentPage;
