import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, Navigate, useSearchParams } from 'react-router-dom';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useClients } from '@/context/ClientsContext';
import { useAuth } from '@/context/AuthContext';
import { groupDocumentsByBaseNameMap } from '@/utils/documentGrouping';
import { getErrorMessage } from '@/utils/errors';
import type { Document } from '@/api/types';
import { I } from '@/components/docflow/icons';
import MessagesPanel from '@/components/docflow/MessagesPanel';
import { CLIENT_UPLOAD_EVENT } from '@/components/docflow/ClientTopbar';
import { useToast } from '@/hooks/use-toast';

const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const formatRelative = (d: Date | null) => {
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};
const fmtMoney = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const ClientPortal = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const { documents, fulfillRequest, uploadDocument } = useDocumentsStore();
  const { clients } = useClients();
  const { me } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestUploadRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q')?.trim().toLowerCase() || '';

  // Upload button in the topbar dispatches this; open the picker within the gesture.
  useEffect(() => {
    const onUpload = () => fileInputRef.current?.click();
    window.addEventListener(CLIENT_UPLOAD_EVENT, onUpload);
    return () => window.removeEventListener(CLIENT_UPLOAD_EVENT, onUpload);
  }, []);

  const client = clients.find(c => c.id === clientId);

  // All hooks must run before any early return (rules of hooks).
  const myDocs = useMemo(
    () => (client ? documents.filter(d => d.clientId === client.id && !d.isRequested && d.folder !== 'Reports') : []),
    [documents, client]
  );
  const myRequests = useMemo(
    () => (client ? documents.filter(d => d.clientId === client.id && d.isRequested) : []),
    [documents, client]
  );
  const sharedWithMe = useMemo(
    () => (client ? documents.filter(d => d.clientId === client.id && d.folder === 'Reports' && !d.isRequested) : []),
    [documents, client]
  );
  const lastUpload = useMemo(() => {
    if (myDocs.length === 0) return null;
    return [...myDocs].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
  }, [myDocs]);
  const myDocGroups = useMemo(
    () => groupDocumentsByBaseNameMap(q ? myDocs.filter(d => d.name.toLowerCase().includes(q)) : myDocs),
    [myDocs, q]
  );

  // Client can only see themselves
  if (me?.kind === 'client' && clientId !== me.id) {
    return <Navigate to={`/client/${me.id}`} replace />;
  }
  if (!client && clients.length > 0) {
    return <Navigate to={`/client/${clients[0].id}`} replace />;
  }
  if (!client) {
    return <div className="df-page"><div className="df-empty">Loading…</div></div>;
  }

  const initials = client.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const advisorName = me?.kind === 'client' ? me.providerName : null;

  const uploadFiles = async (files: FileList, fulfillsRequestId?: string) => {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    try {
      if (fulfillsRequestId && files[0]) {
        await fulfillRequest(fulfillsRequestId, files[0]);
        toast({ title: 'Request fulfilled', description: `${files[0].name} uploaded.` });
        return;
      }
      for (const file of Array.from(files)) {
        await uploadDocument({ clientId: client.id, file });
      }
      toast({
        title: files.length > 1 ? 'Files uploaded' : 'File uploaded',
        description: files.length > 1 ? `${files.length} files uploaded successfully.` : `${files[0]?.name} uploaded successfully.`,
      });
    } catch (err) {
      toast({ title: 'Upload failed', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const scrollToMessages = () => messagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div className="df-client-switcher">
          <div className="df-client-avatar">{initials}</div>
          <div>
            <h1 className="df-client-name">Welcome back, {client.name.split(' ')[0]}</h1>
            <div className="df-client-meta">
              <span>{client.email}</span>
              {advisorName && (
                <>
                  <span className="df-dot-sep" />
                  <span>Advisor: <strong style={{ color: 'var(--df-ink)' }}>{advisorName}</strong></span>
                </>
              )}
              <span className="df-dot-sep" />
              <span className="df-live">{lastUpload ? `Last upload ${formatRelative(lastUpload.uploadedAt)}` : 'No uploads yet'}</span>
            </div>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-ghost" onClick={scrollToMessages}><I.Msg size={13} /> Message advisor</button>
          <button className="df-btn df-primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <I.Upload size={13} /> Upload files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.currentTarget.value = ''; }}
          />
        </div>
      </div>

      <div className="df-kpi-strip">
        <div className="df-kpi">
          <div className="df-kpi-label">Portfolio value</div>
          <div className="df-kpi-value df-mono">{client.aum != null ? fmtMoney(client.aum) : '—'}</div>
          <div className="df-kpi-trend"><span className="df-muted">assets under management</span></div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">My documents</div>
          <div className="df-kpi-value df-mono">{myDocs.length}</div>
          <div className="df-kpi-trend"><span className="df-muted">{myDocs.length > 0 ? `${myDocs.length} on file` : 'none yet'}</span></div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Pending requests</div>
          <div className="df-kpi-value df-mono">{myRequests.length}</div>
          <div className={'df-kpi-trend ' + (myRequests.length > 0 ? 'df-warn' : '')}>
            {myRequests.length > 0 ? 'Awaiting upload' : 'All caught up'}
          </div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Shared with me</div>
          <div className="df-kpi-value df-mono">{sharedWithMe.length}</div>
          <div className="df-kpi-trend"><span className="df-muted">deliverables from advisor</span></div>
        </div>
      </div>

      <div className="df-section" id="requests">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Requested from you</div>
            <div className="df-section-sub">{myRequests.length} document{myRequests.length !== 1 ? 's' : ''} your advisor is waiting on</div>
          </div>
          <div className="df-right">
            {myRequests.length > 0 && <span className="df-pill df-warn">{myRequests.length} pending</span>}
          </div>
        </div>
        <div className="df-section-body">
          {myRequests.length === 0 ? (
            <div className="df-empty">No outstanding requests. You're all caught up.</div>
          ) : (
            <div className="df-list">
              {myRequests.map(req => (
                <div
                  key={req.id}
                  className="df-row"
                  style={{ gridTemplateColumns: '32px 1fr auto auto', borderTop: '1px solid var(--df-border-soft)' }}
                >
                  <div
                    style={{
                      width: 26, height: 32, borderRadius: 4,
                      background: 'var(--df-warn-soft)', border: '1px solid oklch(85% 0.06 75)',
                      display: 'grid', placeItems: 'end center', paddingBottom: 3,
                      fontFamily: 'var(--df-mono)', fontSize: 8.5, fontWeight: 600, color: 'oklch(45% 0.13 65)',
                    }}
                  >
                    REQ
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{req.name}</div>
                    <div className="df-meta">
                      Requested {req.requestedAt ? formatDate(req.requestedAt) : '—'}
                      {req.requestFrequency && <> · cadence: {req.requestFrequency}</>}
                      {req.description && <div style={{ marginTop: 2 }}>{req.description}</div>}
                    </div>
                  </div>
                  <span className="df-pill df-warn">{req.requestFrequency || 'one-time'}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="df-btn df-sm df-primary"
                      disabled={uploading}
                      onClick={() => requestUploadRefs.current[req.id]?.click()}
                    >
                      <I.Upload size={12} /> Upload
                    </button>
                    <input
                      ref={(el) => { requestUploadRefs.current[req.id] = el; }}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={(e) => { if (e.target.files) uploadFiles(e.target.files, req.id); e.currentTarget.value = ''; }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="df-section" id="documents">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">My documents</div>
            <div className="df-section-sub">{myDocs.length} file{myDocs.length !== 1 ? 's' : ''} you've uploaded</div>
          </div>
          <div className="df-right">
            <button className="df-btn df-sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <I.Plus size={12} /> Upload
            </button>
          </div>
        </div>
        <div className="df-section-body">
          <div style={{ marginBottom: 14 }}>
            <div
              className="df-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="df-ic"><I.Upload size={14} /></div>
              <div style={{ flex: 1 }}>
                <strong>{uploading ? 'Uploading…' : 'Drop files to upload'}</strong>
                <div className="df-small df-muted">PDF, DOC, XLS, image · up to 25 MB · automatically shared with your advisor</div>
              </div>
              <button className="df-btn df-sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>Browse</button>
            </div>
          </div>

          {myDocGroups.size === 0 ? (
            <div className="df-doc-empty">You haven't uploaded any documents yet.</div>
          ) : (
            <div className="df-grid-3">
              {Array.from(myDocGroups.entries()).map(([groupName, items]) => (
                <ClientDocCard key={groupName} groupName={groupName} items={items} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="df-section" id="messages">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Messages</div>
            <div className="df-section-sub">Secure thread with {advisorName || 'your advisor'}</div>
          </div>
        </div>
        <div className="df-section-body">
          <MessagesPanel ref={messagesRef} clientId={client.id} meKind="client" subtitle={advisorName || 'Your advisor'} />
        </div>
      </div>
    </div>
  );
};

const ClientDocCard: React.FC<{ groupName: string; items: Document[] }> = ({ groupName, items }) => {
  const years = useMemo(
    () => Array.from(new Set(items.map(i => i.uploadedAt.getFullYear()))).sort((a, b) => b - a),
    [items]
  );
  const [year, setYear] = useState<number>(years[0]);
  useEffect(() => { if (!years.includes(year)) setYear(years[0]); }, [years, year]);

  const filtered = items
    .filter(i => i.uploadedAt.getFullYear() === year)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  const idx = years.indexOf(year);

  return (
    <div className="df-doc-card">
      <div className="df-doc-card-head">
        <div className="df-title">{groupName}</div>
        <div className="df-year-nav">
          <button disabled={idx >= years.length - 1} onClick={() => setYear(years[idx + 1])} aria-label="Older">
            <I.ChevronL size={12} />
          </button>
          <div className="df-label df-mono">{year}</div>
          <button disabled={idx <= 0} onClick={() => setYear(years[idx - 1])} aria-label="Newer">
            <I.ChevronR size={12} />
          </button>
        </div>
      </div>
      <div className="df-doc-card-body">
        {filtered.length === 0 && <div className="df-doc-empty">No items for {year}</div>}
        {filtered.map((it, i) => (
          <div key={it.id} className="df-doc-item">
            <div style={{ minWidth: 0 }}>
              <div className="df-doc-name">{it.name}</div>
              <div className="df-doc-sub">{it.size || '—'} · {formatDate(it.uploadedAt)}</div>
            </div>
            <div className="df-doc-item-pills">
              {i === 0 && <span className="df-pill df-plain">Latest</span>}
              {it.hasUpdateRequest && <span className="df-pill df-danger">Update requested</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClientPortal;
