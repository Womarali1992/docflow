import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClients, useSearch } from '@/api/queries';
import type { RequestStatus } from '@/api/types';
import { I } from '@/components/docflow/icons';

/**
 * Search across the firm's file: documents and checklist lines together,
 * because "where is the 2026 W-2?" and "did we ever ask for it?" are the same
 * question asked twice.
 *
 * The search runs on the server. That is not an optimisation — scope is not a
 * filter the browser is allowed to set: an advisor searches their own firm, a
 * client their own file, and an unshared deliverable is in neither result.
 */

const STATUS_OPTIONS: { value: RequestStatus | ''; label: string }[] = [
  { value: '', label: 'Any status' },
  { value: 'requested', label: 'Requested' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'needs_correction', label: 'Needs correction' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'waived', label: 'Waived' },
];

const STATUS_PILL: Record<RequestStatus, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'df-warn' },
  submitted: { label: 'Submitted', cls: 'df-info' },
  in_review: { label: 'In review', cls: 'df-info' },
  needs_correction: { label: 'Needs correction', cls: 'df-danger' },
  accepted: { label: 'Accepted', cls: 'df-ok' },
  waived: { label: 'Waived', cls: 'df-plain' },
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const thisYear = new Date().getFullYear();
const YEARS = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4];

const DocumentsPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: clients = [] } = useClients();

  const clientId = params.get('client') || '';
  const category = params.get('category') || '';
  const status = (params.get('status') || '') as RequestStatus | '';
  const yearParam = params.get('year') || '';

  /* The text box types faster than the server can answer; the URL follows it a
     beat later so a search is still a link you can send someone. */
  const [text, setText] = useState(params.get('q') || '');
  useEffect(() => {
    const t = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (text.trim()) next.set('q', text.trim());
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, setParams]);

  const setParam = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  const query = useMemo(
    () => ({
      q: params.get('q') || undefined,
      clientId: clientId || undefined,
      category: category || undefined,
      status: (status || undefined) as RequestStatus | undefined,
      year: yearParam ? Number(yearParam) : undefined,
    }),
    [params, clientId, category, status, yearParam]
  );

  const { data, isPending, isFetching } = useSearch(query);
  const asked = Boolean(query.q || query.category || query.status || query.year !== undefined);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'Client';
  }, [clients]);

  const clearAll = () => {
    setText('');
    setParams({}, { replace: true });
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Documents</h1>
          <div className="df-client-meta">
            <span>Search every client's file</span>
            {data && asked && (
              <>
                <span className="df-dot-sep" />
                <span>
                  {data.documents.length} document{data.documents.length === 1 ? '' : 's'} · {data.requests.length} checklist item
                  {data.requests.length === 1 ? '' : 's'}
                  {data.truncated ? ' · showing the first 50 of each' : ''}
                </span>
              </>
            )}
          </div>
        </div>
        {asked && (
          <div className="df-head-actions">
            <button className="df-btn df-ghost" onClick={clearAll}>Clear</button>
          </div>
        )}
      </div>

      <div className="df-section">
        <div className="df-section-head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="df-search" style={{ maxWidth: 300 }}>
            <I.Search size={14} />
            <input
              placeholder="Name, filename or category…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search"
              autoFocus
            />
          </div>
          <div className="df-right" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="df-input df-sm" value={clientId} onChange={(e) => setParam('client', e.target.value)} aria-label="Client">
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="df-input df-sm" value={yearParam} onChange={(e) => setParam('year', e.target.value)} aria-label="Tax year">
              <option value="">Any year</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="df-input df-sm" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input
              className="df-input df-sm"
              placeholder="Category"
              value={category}
              onChange={(e) => setParam('category', e.target.value)}
              aria-label="Category"
              style={{ width: 140 }}
            />
          </div>
        </div>

        {!asked && (
          <div className="df-empty">
            Type a name, or narrow by client, year, status or category. Search covers documents and the checklist lines
            they answer.
          </div>
        )}

        {asked && (
          <div className="df-list">
            {isPending && <div className="df-empty">Searching…</div>}
            {!isPending && data && data.documents.length === 0 && data.requests.length === 0 && (
              <div className="df-empty">Nothing matches that.{isFetching ? ' Still looking…' : ''}</div>
            )}

            {data?.documents.map((d) => (
              <div
                key={d.id}
                className="df-row df-clickable"
                style={{ gridTemplateColumns: '1fr 160px auto' }}
                onClick={() => navigate(`/review/${d.id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/review/${d.id}`); }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{d.displayName ?? d.name}</div>
                  <div className="df-meta">
                    {d.kind === 'deliverable' ? 'Deliverable' : 'Client upload'}
                    {d.category ? ` · ${d.category}` : ''} · {formatDate(d.uploadedAt)}
                  </div>
                </div>
                <div className="df-meta" style={{ marginTop: 0 }}>{clientName(d.clientId)}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  {d.kind === 'deliverable' && (d.shared ? <span className="df-pill df-ok">Shared</span> : <span className="df-pill df-plain">Private</span>)}
                  {d.archivedAt && <span className="df-pill df-plain">Archived</span>}
                </div>
              </div>
            ))}

            {data && data.requests.length > 0 && (
              <div className="df-row" style={{ gridTemplateColumns: '1fr', background: 'var(--df-panel-2)' }}>
                <div className="df-field-label" style={{ margin: 0 }}>Checklist items</div>
              </div>
            )}

            {data?.requests.map((r) => (
              <div
                key={r.id}
                className="df-row df-clickable"
                style={{ gridTemplateColumns: '1fr 160px auto' }}
                onClick={() => navigate(`/engagements/${r.engagementId}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/engagements/${r.engagementId}`); }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{r.title}</div>
                  <div className="df-meta">
                    {r.category ?? 'Checklist item'}
                    {r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ''}
                  </div>
                </div>
                <div className="df-meta" style={{ marginTop: 0 }}>{clientName(r.clientId)}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  {r.overdue && <span className="df-pill df-danger">Overdue</span>}
                  <span className={'df-pill ' + STATUS_PILL[r.status].cls}>{STATUS_PILL[r.status].label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentsPage;
