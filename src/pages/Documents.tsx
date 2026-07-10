import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useClients } from '@/context/ClientsContext';
import { api } from '@/api/client';
import { I } from '@/components/docflow/icons';

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  pending:      { label: 'Pending',          cls: 'df-warn' },
  reviewed:     { label: 'Reviewed',         cls: 'df-ok' },
  needs_update: { label: 'Update requested', cls: 'df-danger' },
  in_review:    { label: 'In review',        cls: 'df-info' },
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const DocumentsPage = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { documents } = useDocumentsStore();
  const { clients } = useClients();

  const q = params.get('q') || '';
  const clientFilter = params.get('client') || '';
  const folder = params.get('folder') || '';

  const setParam = (key: string, value: string) => {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (value) nextParams.set(key, value);
      else nextParams.delete(key);
      return nextParams;
    });
  };

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) || '—';
  }, [clients]);

  const folders = useMemo(
    () => Array.from(new Set(documents.map((d) => d.folder).filter(Boolean))) as string[],
    [documents]
  );

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return documents
      .filter((d) =>
        (!ql || d.name.toLowerCase().includes(ql)) &&
        (!clientFilter || d.clientId === clientFilter) &&
        (!folder || d.folder === folder)
      )
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }, [documents, q, clientFilter, folder]);

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Documents</h1>
          <div className="df-client-meta">
            <span>{filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}</span>
            {folder && <><span className="df-dot-sep" /><span>Folder: {folder}</span></>}
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="df-search" style={{ maxWidth: 280 }}>
            <I.Search size={14} />
            <input placeholder="Search by name…" value={q} onChange={(e) => setParam('q', e.target.value)} />
          </div>
          <div className="df-right" style={{ gap: 8 }}>
            <select className="df-input" value={clientFilter} onChange={(e) => setParam('client', e.target.value)} aria-label="Filter by client">
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="df-input" value={folder} onChange={(e) => setParam('folder', e.target.value)} aria-label="Filter by folder">
              <option value="">All folders</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div className="df-list">
          {filtered.length === 0 ? (
            <div className="df-empty">No documents match these filters.</div>
          ) : (
            filtered.map((d) => {
              const status = d.isRequested ? { label: 'Requested', cls: 'df-warn' } : (d.hasUpdateRequest ? STATUS_PILL.needs_update : (d.status ? STATUS_PILL[d.status] : null));
              return (
                <div
                  key={d.id}
                  className="df-row df-clickable"
                  style={{ gridTemplateColumns: '1fr 140px 120px auto auto' }}
                  onClick={() => navigate(`/documents/${d.id}`)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{d.name}</div>
                    <div className="df-meta">{d.folder} · {d.size || '—'} · {formatDate(d.uploadedAt)}</div>
                  </div>
                  <div className="df-meta" style={{ marginTop: 0 }}>{clientName(d.clientId)}</div>
                  <div>{status && <span className={'df-pill ' + status.cls}>{status.label}</span>}</div>
                  <div>
                    {d.storagePath && (
                      <a
                        href={api.documents.downloadUrl(d.id, { attachment: true })}
                        className="df-btn df-ghost df-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <I.Download size={12} /> Download
                      </a>
                    )}
                  </div>
                  <button className="df-btn df-ghost df-sm" onClick={(e) => { e.stopPropagation(); navigate(`/documents/${d.id}`); }}>Open</button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentsPage;
