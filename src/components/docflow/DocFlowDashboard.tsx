import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useClients } from '@/context/ClientsContext';
import { getBaseDocumentName, groupDocumentsByBaseNameMap } from '@/utils/documentGrouping';
import type { Document, Client, RequestFrequency } from '@/api/types';
import { downloadCsv } from '@/utils/csv';
import { getErrorMessage } from '@/utils/errors';
import { useToast } from '@/hooks/use-toast';
import { I } from './icons';
import ActivityFeed from './ActivityFeed';
import MessagesPanel from './MessagesPanel';
import RequestDocumentDialog from './RequestDocumentDialog';
import ClientAccess from './ClientAccess';

type Tab = 'uploads' | 'requested' | 'deliverables';

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  pending:      { label: 'Pending',          cls: 'df-warn' },
  reviewed:     { label: 'Reviewed',         cls: 'df-ok' },
  needs_update: { label: 'Update requested', cls: 'df-danger' },
  in_review:    { label: 'In review',        cls: 'df-info' },
};

const DOC_TYPES = [
  'Bank Statement', 'Tax Return', 'ID Copy', 'Pay Stub', 'Investment Statement',
  'Insurance Policy', 'W-2', '1099', 'Mortgage Statement', 'Business Financials',
  'K-1', 'Trust Agreement',
];

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

interface Props {
  initialClientId?: string;
}

const DocFlowDashboard: React.FC<Props> = ({ initialClientId }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { documents, fulfillRequest, uploadDocument } = useDocumentsStore();
  const { clients, loading: clientsLoading } = useClients();

  const initialIndex = useMemo(() => {
    if (!initialClientId || clients.length === 0) return 0;
    const idx = clients.findIndex(c => c.id === initialClientId);
    return idx >= 0 ? idx : 0;
  }, [initialClientId, clients]);

  const [clientIdx, setClientIdx] = useState(initialIndex);
  const [tab, setTab] = useState<Tab>('uploads');
  const [selectedDoc, setSelectedDoc] = useState<{ id: string; name: string } | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setClientIdx(initialIndex);
  }, [initialIndex]);

  const client: Client | undefined = clients[clientIdx];

  useEffect(() => {
    setSelectedDoc(null);
  }, [client?.id, tab]);

  if (clientsLoading && clients.length === 0) {
    return <div className="df-page"><div className="df-empty">Loading clients…</div></div>;
  }
  if (!client) {
    return <div className="df-page"><div className="df-empty">No clients yet — create one to get started.</div></div>;
  }

  const initials = client.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();

  const next = () => {
    const idx = (clientIdx + 1) % clients.length;
    setClientIdx(idx);
    navigate(`/clients/${clients[idx].id}`, { replace: true });
  };
  const prev = () => {
    const idx = (clientIdx - 1 + clients.length) % clients.length;
    setClientIdx(idx);
    navigate(`/clients/${clients[idx].id}`, { replace: true });
  };

  const clientDocs = documents.filter(d => d.clientId === client.id);
  const uploads     = clientDocs.filter(d => !d.isRequested && d.folder !== 'Reports');
  const requested   = clientDocs.filter(d => d.isRequested);
  const deliverables = clientDocs.filter(d => d.folder === 'Reports' && !d.isRequested);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'uploads',      label: 'Client uploads', count: uploads.length },
    { id: 'requested',    label: 'Requested',      count: requested.length },
    { id: 'deliverables', label: 'Deliverables',   count: deliverables.length },
  ];

  const groups =
    tab === 'uploads' ? groupDocumentsByBaseNameMap(uploads) :
    tab === 'requested' ? groupDocumentsByBaseNameMap(requested) :
    groupDocumentsByBaseNameMap(deliverables);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length || uploading) return;
    setUploading(true);
    // Match each file to an outstanding request by base name; unmatched files upload.
    const outstanding = clientDocs.filter(d => d.isRequested);
    let fulfilled = 0;
    let uploaded = 0;
    try {
      for (const file of files) {
        const fileBase = getBaseDocumentName({ name: file.name }).toLowerCase();
        const matchIdx = outstanding.findIndex(
          r => getBaseDocumentName({ name: r.name, requestFrequency: r.requestFrequency }).toLowerCase() === fileBase
        );
        if (matchIdx >= 0) {
          const [match] = outstanding.splice(matchIdx, 1);
          await fulfillRequest(match.id, file);
          fulfilled++;
        } else {
          await uploadDocument({ clientId: client.id, file, folder: tab === 'deliverables' ? 'Reports' : 'Uploads' });
          uploaded++;
        }
      }
      const parts: string[] = [];
      if (fulfilled) parts.push(`${fulfilled} request${fulfilled !== 1 ? 's' : ''} fulfilled`);
      if (uploaded) parts.push(`${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded`);
      toast({ title: 'Upload complete', description: parts.join(' · ') || 'Done.' });
    } catch (e) {
      toast({ title: 'Upload failed', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  const exportCsv = () => {
    downloadCsv(
      `${client.name.replace(/\s+/g, '-').toLowerCase()}-documents`,
      ['Name', 'Folder', 'Status', 'Requested', 'Size', 'Uploaded'],
      clientDocs.map(d => [
        d.name,
        d.folder || '',
        d.isRequested ? 'requested' : (d.status || ''),
        d.isRequested ? 'yes' : 'no',
        d.size || '',
        d.uploadedAt ? formatDate(d.uploadedAt) : '',
      ])
    );
  };

  const scrollToMessages = () => messagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    <div className="df-page">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ''; }}
      />

      <PageHead
        client={client}
        initials={initials}
        onPrev={prev}
        onNext={next}
        onExport={exportCsv}
        onMessage={scrollToMessages}
        onUpload={openPicker}
        uploading={uploading}
      />
      <KpiStrip client={client} uploads={uploads.length} requested={requested.length} deliverables={deliverables.length} />

      <div className="df-two-col">
        <div style={{ minWidth: 0 }}>
          <div className="df-section">
            <div className="df-section-head">
              <div className="df-seg" role="tablist">
                {tabs.map(tb => (
                  <button
                    key={tb.id}
                    className={tab === tb.id ? 'df-active' : ''}
                    onClick={() => setTab(tb.id)}
                  >
                    {tb.label}{' '}
                    <span className="df-mono" style={{ opacity: 0.6, marginLeft: 4 }}>{tb.count}</span>
                  </button>
                ))}
              </div>
              <div className="df-right">
                <button className="df-btn df-sm" onClick={() => setRequestOpen(true)}><I.Plus size={12} /> Request</button>
              </div>
            </div>
            <div className="df-section-body">
              <div style={{ marginBottom: 14 }}>
                <div
                  className="df-drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
                  onClick={openPicker}
                >
                  <div className="df-ic"><I.Upload size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <strong>{uploading ? 'Uploading…' : 'Drop files to upload'}</strong>
                    <div className="df-small df-muted">PDF, DOC, XLS, image · up to 25 MB · auto-matched to outstanding requests</div>
                  </div>
                  <button className="df-btn df-sm" onClick={(e) => { e.stopPropagation(); openPicker(); }}>Browse</button>
                </div>
              </div>

              {groups.size === 0 ? (
                <div className="df-doc-empty">No items in this view</div>
              ) : (
                <div className="df-grid-3">
                  {Array.from(groups.entries()).map(([groupName, items]) => (
                    <DocGroupCard
                      key={groupName}
                      groupName={groupName}
                      items={items}
                      kind={tab}
                      selectedId={selectedDoc?.id}
                      onSelect={(d) => { setSelectedDoc({ id: d.id, name: d.name }); scrollToMessages(); }}
                      onOpen={(d) => navigate(`/documents/${d.id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DocumentsNeeded clientId={client.id} />

          <div className="df-section">
            <div className="df-section-head">
              <div>
                <div className="df-section-title">Activity</div>
                <div className="df-section-sub">Recent events for {client.name}</div>
              </div>
            </div>
            <ActivityFeed clientId={client.id} limit={20} refreshKey={documents.length} />
          </div>
        </div>

        <MessagesPanel
          ref={messagesRef}
          clientId={client.id}
          documentId={selectedDoc?.id}
          contextDoc={selectedDoc?.name}
          meKind="provider"
        />
      </div>

      <RequestDocumentDialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        clientId={client.id}
        clientName={client.name}
      />
    </div>
  );
};

const PageHead: React.FC<{
  client: Client;
  initials: string;
  onPrev: () => void;
  onNext: () => void;
  onExport: () => void;
  onMessage: () => void;
  onUpload: () => void;
  uploading: boolean;
}> = ({ client, initials, onPrev, onNext, onExport, onMessage, onUpload, uploading }) => (
  <div className="df-page-head">
    <div className="df-client-switcher">
      <div className="df-pager">
        <button onClick={onPrev} aria-label="Prev"><I.ChevronL size={14} /></button>
        <div className="df-divider" />
        <button onClick={onNext} aria-label="Next"><I.ChevronR size={14} /></button>
      </div>
      <div className="df-client-avatar">{initials}</div>
      <div>
        <h1 className="df-client-name">{client.name}</h1>
        <div className="df-client-meta">
          <span className="df-mono">{client.accountId}</span>
          <span className="df-dot-sep" />
          <span>{client.email}</span>
          <span className="df-dot-sep" />
          <span className="df-live">Active {formatRelative(client.lastActivity)}</span>
        </div>
      </div>
    </div>
    <div className="df-head-actions">
      <ClientAccess client={client} />
      <button className="df-btn df-ghost" onClick={onExport}><I.Download size={13} /> Export</button>
      <button className="df-btn" onClick={onMessage}><I.Msg size={13} /> Message</button>
      <button className="df-btn df-primary" onClick={onUpload} disabled={uploading}><I.Upload size={13} /> Upload files</button>
    </div>
  </div>
);

const KpiStrip: React.FC<{ client: Client; uploads: number; requested: number; deliverables: number }> = ({ client, uploads, requested, deliverables }) => (
  <div className="df-kpi-strip">
    <div className="df-kpi">
      <div className="df-kpi-label">Assets under management</div>
      <div className="df-kpi-value df-mono">{client.aum != null ? fmtMoney(client.aum) : '—'}</div>
      <div className="df-kpi-trend"><span className="df-muted">{client.plan || 'Core'}{client.clientSince ? ` · since ${client.clientSince}` : ''}</span></div>
    </div>
    <div className="df-kpi">
      <div className="df-kpi-label">Documents on file</div>
      <div className="df-kpi-value df-mono">{client.documentsCount}</div>
      <div className="df-kpi-trend"><span className="df-muted">{uploads} uploads · {deliverables} deliverables</span></div>
    </div>
    <div className="df-kpi">
      <div className="df-kpi-label">Pending review</div>
      <div className="df-kpi-value df-mono">{client.pendingUpdates}</div>
      <div className={'df-kpi-trend ' + (client.pendingUpdates > 0 ? 'df-warn' : '')}>
        {client.pendingUpdates > 0 ? `${requested} outstanding request${requested !== 1 ? 's' : ''}` : 'All clear'}
      </div>
    </div>
    <div className="df-kpi">
      <div className="df-kpi-label">Unread messages</div>
      <div className="df-kpi-value df-mono">{client.unreadMessages}</div>
      <div className="df-kpi-trend"><span className="df-muted">{client.unreadMessages > 0 ? 'from this client' : 'all read'}</span></div>
    </div>
  </div>
);

const YearNav: React.FC<{ years: number[]; value: number; onChange: (y: number) => void }> = ({ years, value, onChange }) => {
  const idx = years.indexOf(value);
  return (
    <div className="df-year-nav">
      <button disabled={idx >= years.length - 1} onClick={() => onChange(years[idx + 1])} aria-label="Older">
        <I.ChevronL size={12} />
      </button>
      <div className="df-label df-mono">{value}</div>
      <button disabled={idx <= 0} onClick={() => onChange(years[idx - 1])} aria-label="Newer">
        <I.ChevronR size={12} />
      </button>
    </div>
  );
};

const docDate = (d: Document, kind: Tab): Date => {
  if (kind === 'requested') return d.requestedAt || d.uploadedAt;
  return d.uploadedAt;
};
const docYear = (d: Document, kind: Tab): number => docDate(d, kind).getFullYear();

const DocGroupCard: React.FC<{
  groupName: string;
  items: Document[];
  kind: Tab;
  selectedId?: string;
  onSelect: (d: Document) => void;
  onOpen: (d: Document) => void;
}> = ({ groupName, items, kind, selectedId, onSelect, onOpen }) => {
  const years = useMemo(
    () => Array.from(new Set(items.map(i => docYear(i, kind)))).sort((a, b) => b - a),
    [items, kind]
  );
  const [year, setYear] = useState<number>(years[0]);
  useEffect(() => { if (!years.includes(year)) setYear(years[0]); }, [years, year]);

  const filtered = items
    .filter(i => docYear(i, kind) === year)
    .sort((a, b) => docDate(b, kind).getTime() - docDate(a, kind).getTime());

  return (
    <div className="df-doc-card">
      <div className="df-doc-card-head">
        <div className="df-title">{groupName}</div>
        <YearNav years={years} value={year} onChange={setYear} />
      </div>
      <div className="df-doc-card-body">
        {filtered.length === 0 && <div className="df-doc-empty">No items for {year}</div>}
        {filtered.map((it, idx) => {
          const status = it.hasUpdateRequest ? 'needs_update' : it.status;
          const pill = status ? STATUS_PILL[status] : null;
          const date = docDate(it, kind);
          return (
            <div
              key={it.id}
              className={'df-doc-item' + (selectedId === it.id ? ' df-selected' : '')}
              onClick={() => onSelect(it)}
              onDoubleClick={() => onOpen(it)}
              title="Click to message · double-click to open"
            >
              <div style={{ minWidth: 0 }}>
                <div className="df-doc-name">{it.name}</div>
                <div className="df-doc-sub">
                  {kind === 'requested'
                    ? <>Requested {formatDate(date)}{it.requestFrequency ? ` · ${it.requestFrequency}` : ''}</>
                    : <>{it.size || '—'} · {formatDate(date)}</>}
                </div>
              </div>
              <div className="df-doc-item-pills">
                {idx === 0 && kind !== 'requested' && (
                  <span className="df-pill df-plain">Latest</span>
                )}
                {kind === 'requested' && it.requestFrequency && (
                  <span className="df-pill df-warn">{it.requestFrequency}</span>
                )}
                {pill && <span className={'df-pill ' + pill.cls}>{pill.label}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type Bin = { id: string; label: string; freq: RequestFrequency; items: { id: string; name: string }[] };

const DEFAULT_BINS: Bin[] = [
  { id: 'b-m', label: 'Monthly',   freq: 'monthly',   items: [{ id: 'i1', name: 'Bank Statement' }] },
  { id: 'b-q', label: 'Quarterly', freq: 'quarterly', items: [{ id: 'i2', name: 'Investment Statement' }, { id: 'i3', name: 'Business Financials' }] },
  { id: 'b-y', label: 'Yearly',    freq: 'yearly',    items: [{ id: 'i4', name: 'Tax Return' }] },
  { id: 'b-o', label: 'One-time',  freq: 'one-time',  items: [] },
];

const freqFromLabel = (label: string): RequestFrequency => {
  const l = label.toLowerCase();
  if (l.includes('day')) return 'daily';
  if (l.includes('month')) return 'monthly';
  if (l.includes('quarter')) return 'quarterly';
  if (l.includes('year')) return 'yearly';
  return 'one-time';
};

const DocumentsNeeded: React.FC<{ clientId: string }> = ({ clientId }) => {
  const { requestDocument, presets } = useDocumentsStore();
  const { toast } = useToast();
  const [bins, setBins] = useState<Bin[]>(DEFAULT_BINS);
  const [overId, setOverId] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>(DOC_TYPES);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('');
  const [applying, setApplying] = useState(false);

  const onDragStart = (e: React.DragEvent, name: string) => {
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const onDrop = (e: React.DragEvent, binId: string) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/plain');
    setOverId(null);
    if (!name) return;
    setBins(prev => prev.map(b => {
      if (b.id !== binId) return b;
      if (b.items.some(i => i.name.toLowerCase() === name.toLowerCase())) return b;
      return { ...b, items: [...b.items, { id: `${binId}-${b.items.length}-${name}`, name }] };
    }));
  };
  const remove = (binId: string, itemId: string) =>
    setBins(prev => prev.map(b => b.id === binId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b));

  const loadPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) { setBins(DEFAULT_BINS); return; }
    setBins(preset.bins.map((bin, bi) => ({
      id: `p-${bi}`,
      label: bin.label,
      freq: freqFromLabel(bin.label),
      items: bin.items.map((it, ii) => ({ id: `p-${bi}-${ii}`, name: it.name })),
    })));
  };

  const addType = () => {
    const t = newType.trim();
    if (!t) { setAdding(false); return; }
    if (!types.some(x => x.toLowerCase() === t.toLowerCase())) setTypes(prev => [t, ...prev]);
    setNewType('');
    setAdding(false);
  };

  const total = bins.reduce((s, b) => s + b.items.length, 0);

  const apply = async () => {
    if (!total || applying) return;
    setApplying(true);
    try {
      let count = 0;
      for (const bin of bins) {
        for (const item of bin.items) {
          await requestDocument({ documentName: item.name, clientId, frequency: bin.freq });
          count++;
        }
      }
      toast({ title: 'Requests sent', description: `${count} document${count !== 1 ? 's' : ''} requested.` });
    } catch (e) {
      toast({ title: 'Could not send requests', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Documents needed</div>
          <div className="df-section-sub">{total} item{total !== 1 ? 's' : ''} · drag types into a cadence, then send</div>
        </div>
        <div className="df-right" style={{ gap: 6 }}>
          {presets.length > 0 && (
            <select className="df-input df-sm" defaultValue="" onChange={(e) => loadPreset(e.target.value)} aria-label="Load preset">
              <option value="" disabled>Load preset…</option>
              {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {adding ? (
            <input
              className="df-input df-sm"
              autoFocus
              value={newType}
              placeholder="New type…"
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addType(); if (e.key === 'Escape') { setNewType(''); setAdding(false); } }}
              onBlur={addType}
              style={{ width: 130 }}
            />
          ) : (
            <button className="df-btn df-sm" onClick={() => setAdding(true)}><I.Plus size={12} /> Add type</button>
          )}
          <button className="df-btn df-sm df-primary" onClick={apply} disabled={!total || applying}>
            <I.Send size={12} /> {applying ? 'Sending…' : 'Send requests'}
          </button>
        </div>
      </div>
      <div className="df-section-body">
        <div className="df-bins">
          {bins.map(bin => (
            <div
              key={bin.id}
              className={'df-bin' + (overId === bin.id ? ' df-over' : '')}
              onDragOver={(e) => { e.preventDefault(); setOverId(bin.id); }}
              onDragLeave={() => setOverId(null)}
              onDrop={(e) => onDrop(e, bin.id)}
            >
              <div className="df-bin-head">
                <span className="df-bin-label">{bin.label}</span>
                <span className="df-bin-cnt">{bin.items.length}</span>
              </div>
              {bin.items.length === 0 && <div className="df-bin-empty">Drop a type here</div>}
              {bin.items.map(it => (
                <div key={it.id} className="df-bin-item">
                  <span className="df-dotc" />
                  <span>{it.name}</span>
                  <span className="df-x" onClick={() => remove(bin.id, it.id)}><I.X size={11} /></span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="df-types">
          {types.map(t => (
            <div key={t} className="df-type-chip" draggable onDragStart={(e) => onDragStart(e, t)}>
              <span className="df-plus">+</span>{t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DocFlowDashboard;
