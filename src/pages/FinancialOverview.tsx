import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DayContentProps } from 'react-day-picker';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useClients } from '@/context/ClientsContext';
import type { Document, RequestFrequency } from '@/api/types';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { I } from '@/components/docflow/icons';
import { getErrorMessage } from '@/utils/errors';
import { useToast } from '@/hooks/use-toast';

const getNextDueDate = (uploadedAt: Date, frequency?: RequestFrequency, explicit?: Date | undefined) => {
  if (explicit) return explicit;
  if (!frequency || frequency === 'one-time') return undefined;
  const next = new Date(uploadedAt);
  switch (frequency) {
    case 'daily':     next.setDate(next.getDate() + 1); break;
    case 'monthly':   next.setMonth(next.getMonth() + 1); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'yearly':    next.setFullYear(next.getFullYear() + 1); break;
    default: return undefined;
  }
  return next;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatLongDate = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

interface DayEvent {
  doc: Document;
  due: Date;
  isOverdue: boolean;
}

const FinancialOverview = () => {
  const { documents, updateDocumentDueDate } = useDocumentsStore();
  const { clients } = useClients();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());

  // Add-deadline inline form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addClientId, setAddClientId] = useState<string>('');
  const [addDocId, setAddDocId] = useState<string>('');

  // Stable "now" for the lifetime of the view so memo deps don't change each render.
  const now = useMemo(() => new Date(), []);
  const soonThreshold = useMemo(() => {
    const d = new Date(now);
    d.setDate(now.getDate() + 14);
    return d;
  }, [now]);

  // Filtered docs (by client toggle)
  const filteredDocuments = useMemo(() => {
    if (selectedClientIds.size === 0) return documents;
    return documents.filter(d => d.clientId && selectedClientIds.has(d.clientId));
  }, [documents, selectedClientIds]);

  // All due events with metadata
  const allEvents = useMemo<DayEvent[]>(() => {
    return filteredDocuments
      .map(d => {
        const due = getNextDueDate(d.uploadedAt, d.requestFrequency || undefined, d.dueDate || undefined);
        return due ? { doc: d, due, isOverdue: due < now } : null;
      })
      .filter(Boolean) as DayEvent[];
  }, [filteredDocuments, now]);

  // Map: yyyy-mm-dd → events
  const eventsByDayKey = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    for (const e of allEvents) {
      const key = e.due.toDateString();
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return map;
  }, [allEvents]);

  const eventsForSelected = eventsByDayKey.get(selectedDate.toDateString()) ?? [];

  // KPI counts
  const overdue = allEvents.filter(e => e.isOverdue);
  const dueSoon = allEvents.filter(e => !e.isOverdue && e.due <= soonThreshold);
  const pendingRequests = documents.filter(d => d.isRequested && !d.url);

  // Client summary table
  const clientRows = useMemo(() => {
    return clients.map(client => {
      const clientDocs = documents.filter(d => d.clientId === client.id);
      const clientDue = clientDocs
        .map(d => ({ doc: d, due: getNextDueDate(d.uploadedAt, d.requestFrequency || undefined, d.dueDate || undefined) }))
        .filter(x => x.due);
      const cOverdue = clientDue.filter(x => x.due! < now).length;
      const cDueSoon = clientDue.filter(x => x.due! >= now && x.due! <= soonThreshold).length;
      return { client, documentsCount: clientDocs.length, dueSoon: cDueSoon, overdue: cOverdue };
    });
  }, [clients, documents, now, soonThreshold]);

  // Upcoming list
  const upcoming = useMemo(() => {
    return [...allEvents]
      .sort((a, b) => a.due.getTime() - b.due.getTime())
      .slice(0, 8);
  }, [allEvents]);

  // Compact day cell — date number + dot/count only
  const DayContent = React.useCallback(({ date }: DayContentProps) => {
    const events = eventsByDayKey.get(date.toDateString()) ?? [];
    const isToday = sameDay(date, now);
    const hasOverdue = events.some(e => e.isOverdue);
    return (
      <div className="df-cal-day">
        <div className={'df-cal-day-num' + (isToday ? ' df-cal-day-today' : '')}>{date.getDate()}</div>
        {events.length > 0 && (
          <div className="df-cal-day-meta">
            <span
              className={'df-cal-dot' + (hasOverdue ? ' df-cal-dot-danger' : '')}
              aria-hidden
            />
            <span className="df-cal-day-count df-mono">{events.length}</span>
          </div>
        )}
      </div>
    );
  }, [eventsByDayKey, now]);

  const toggleClient = (clientId: string) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  };

  // Documents available for the add-form (filter to chosen client; only non-requested)
  const docsForAddClient = useMemo(() => {
    if (!addClientId) return [];
    return documents
      .filter(d => d.clientId === addClientId && !d.isRequested)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [addClientId, documents]);

  const handleAddDeadline = async () => {
    if (!addDocId) {
      toast({ title: 'Select a document', description: 'Pick which document this deadline applies to.', variant: 'destructive' });
      return;
    }
    try {
      await updateDocumentDueDate(addDocId, selectedDate);
      const doc = documents.find(d => d.id === addDocId);
      toast({ title: 'Deadline added', description: `${doc?.name || 'Document'} due ${formatLongDate(selectedDate)}.` });
      setShowAddForm(false);
      setAddClientId('');
      setAddDocId('');
    } catch (err) {
      toast({ title: 'Failed to set deadline', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleClearDueDate = async (docId: string, name: string) => {
    try {
      await updateDocumentDueDate(docId, undefined);
      toast({ title: 'Deadline cleared', description: `${name} no longer has a fixed deadline.` });
    } catch (err) {
      toast({ title: 'Failed', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Calendar</h1>
          <div className="df-client-meta">
            <span>Tracking {documents.length} documents</span>
            <span className="df-dot-sep" />
            <span>{dueSoon.length} due in 14 days · {overdue.length} overdue</span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-ghost" onClick={() => setSelectedDate(new Date())}>
            <I.Calendar size={13} /> Today
          </button>
          <button
            className="df-btn df-primary"
            onClick={() => { setShowAddForm(true); }}
          >
            <I.Plus size={13} /> Add deadline
          </button>
        </div>
      </div>

      <div className="df-kpi-strip">
        <div className="df-kpi">
          <div className="df-kpi-label">Total clients</div>
          <div className="df-kpi-value df-mono">{clients.length}</div>
          <div className="df-kpi-trend"><span className="df-muted">all active</span></div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Due in 14 days</div>
          <div className="df-kpi-value df-mono">{dueSoon.length}</div>
          <div className="df-kpi-trend df-warn">{dueSoon.length > 0 ? 'review schedule' : 'all clear'}</div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Overdue</div>
          <div
            className="df-kpi-value df-mono"
            style={{ color: overdue.length > 0 ? 'var(--df-danger)' : undefined }}
          >
            {overdue.length}
          </div>
          <div className="df-kpi-trend">
            {overdue.length > 0
              ? <span style={{ color: 'var(--df-danger)' }}>follow up needed</span>
              : <span className="df-muted">none</span>}
          </div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Pending requests</div>
          <div className="df-kpi-value df-mono">{pendingRequests.length}</div>
          <div className="df-kpi-trend"><span className="df-muted">awaiting client upload</span></div>
        </div>
      </div>

      {/* Schedule: filter chips → calendar | day detail */}
      <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Schedule</div>
            <div className="df-section-sub">
              {selectedClientIds.size > 0 ? `${selectedClientIds.size} filter${selectedClientIds.size > 1 ? 's' : ''} active` : 'all clients'} · click a day to see events
            </div>
          </div>
          <div className="df-right">
            <div className="df-filter-chips">
              <button
                className={'df-pill df-clickable' + (selectedClientIds.size === 0 ? ' df-pill-on' : '')}
                onClick={() => setSelectedClientIds(new Set())}
                type="button"
              >
                All
              </button>
              {clients.map(c => {
                const active = selectedClientIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    className={'df-pill df-clickable' + (active ? ' df-pill-on' : '')}
                    onClick={() => toggleClient(c.id)}
                    type="button"
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="df-section-body">
          <div className="df-cal-grid">
            <div className="df-cal-frame">
              <CalendarUI
                mode="single"
                numberOfMonths={1}
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                components={{ DayContent }}
                classNames={{
                  head_row: 'flex w-full',
                  head_cell: 'flex-1 text-center',
                  day: 'w-full h-full p-0 font-normal aria-selected:opacity-100 text-left',
                  cell: 'flex-1 min-h-16 md:min-h-20 text-left align-top p-0 relative',
                }}
              />
            </div>

            <DayPanel
              date={selectedDate}
              events={eventsForSelected}
              onAddDeadline={() => setShowAddForm(true)}
              showAddForm={showAddForm}
              onCloseAddForm={() => setShowAddForm(false)}
              clients={clients}
              addClientId={addClientId}
              setAddClientId={setAddClientId}
              addDocId={addDocId}
              setAddDocId={setAddDocId}
              docsForAddClient={docsForAddClient}
              onConfirmAdd={handleAddDeadline}
              onClearDueDate={handleClearDueDate}
            />
          </div>
        </div>
      </div>

      <div className="df-grid-2-aside">
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Clients overview</div>
              <div className="df-section-sub">Workload summary</div>
            </div>
          </div>
          <div className="df-list">
            <div
              className="df-row"
              style={{ gridTemplateColumns: '1fr 90px 90px 90px', background: 'var(--df-panel-2)', borderTop: 0 }}
            >
              <div className="df-muted" style={{ fontSize: 11.5, fontWeight: 500 }}>Client</div>
              <div className="df-muted" style={{ fontSize: 11.5, fontWeight: 500, textAlign: 'right' }}>Docs</div>
              <div className="df-muted" style={{ fontSize: 11.5, fontWeight: 500, textAlign: 'right' }}>Due soon</div>
              <div className="df-muted" style={{ fontSize: 11.5, fontWeight: 500, textAlign: 'right' }}>Overdue</div>
            </div>
            {clientRows.map(row => (
              <div
                key={row.client.id}
                className="df-row df-clickable"
                style={{ gridTemplateColumns: '1fr 90px 90px 90px' }}
              >
                <div>
                  <div className="df-name">
                    <Link className="df-link" to={`/clients/${row.client.id}`}>{row.client.name}</Link>
                  </div>
                  <div className="df-meta">{row.client.email}</div>
                </div>
                <div className="df-mono" style={{ textAlign: 'right' }}>{row.documentsCount}</div>
                <div style={{ textAlign: 'right' }}>
                  {row.dueSoon > 0 ? <span className="df-pill df-warn">{row.dueSoon}</span> : <span className="df-muted df-mono">0</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {row.overdue > 0 ? <span className="df-pill df-danger">{row.overdue}</span> : <span className="df-muted df-mono">0</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Upcoming deadlines</div>
              <div className="df-section-sub">Next 8</div>
            </div>
          </div>
          <div className="df-list">
            {upcoming.length === 0 && <div className="df-empty">No upcoming deadlines.</div>}
            {upcoming.map(item => {
              const c = clients.find(cc => cc.id === item.doc.clientId);
              return (
                <div
                  key={`${item.doc.id}-${item.due.toISOString()}`}
                  className="df-row df-clickable"
                  style={{ gridTemplateColumns: '1fr auto' }}
                  onClick={() => setSelectedDate(item.due)}
                >
                  <div>
                    <div className="df-name">
                      <Link className="df-link" to={`/documents/${item.doc.id}`}>{item.doc.name}</Link>
                    </div>
                    <div className="df-meta">
                      {c ? <Link className="df-link" to={`/clients/${c.id}`}>{c.name}</Link> : 'Unassigned'}
                      {` · ${item.doc.folder}`}
                    </div>
                  </div>
                  <span className={'df-pill ' + (item.isOverdue ? 'df-danger' : 'df-info')}>
                    {item.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============= Day detail panel ============= */
interface DayPanelProps {
  date: Date;
  events: DayEvent[];
  onAddDeadline: () => void;
  showAddForm: boolean;
  onCloseAddForm: () => void;
  clients: { id: string; name: string }[];
  addClientId: string;
  setAddClientId: (v: string) => void;
  addDocId: string;
  setAddDocId: (v: string) => void;
  docsForAddClient: Document[];
  onConfirmAdd: () => void;
  onClearDueDate: (docId: string, name: string) => void;
}

const DayPanel: React.FC<DayPanelProps> = ({
  date, events, onAddDeadline, showAddForm, onCloseAddForm,
  clients, addClientId, setAddClientId, addDocId, setAddDocId,
  docsForAddClient, onConfirmAdd, onClearDueDate,
}) => {
  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <aside className="df-cal-panel">
      <div className="df-cal-panel-head">
        <div>
          <div className="df-section-title">{formatLongDate(date)}</div>
          <div className="df-section-sub">
            {events.length === 0
              ? 'No deadlines on this day'
              : `${events.length} event${events.length !== 1 ? 's' : ''}${isPast ? ' · past' : ''}`}
          </div>
        </div>
      </div>

      <div className="df-cal-panel-body">
        {events.length === 0 && !showAddForm && (
          <div className="df-empty" style={{ marginTop: 0 }}>
            <div style={{ marginBottom: 10 }}>Quiet day — no documents are due.</div>
            <button className="df-btn df-sm df-primary" onClick={onAddDeadline}>
              <I.Plus size={12} /> Add deadline
            </button>
          </div>
        )}

        {events.length > 0 && (
          <div className="df-list" style={{ borderTop: 'none' }}>
            {events.map(e => (
              <div
                key={e.doc.id}
                className="df-row"
                style={{
                  gridTemplateColumns: '1fr',
                  borderTop: '1px solid var(--df-border-soft)',
                  padding: '10px 0',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="df-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link className="df-link" to={`/documents/${e.doc.id}`}>{e.doc.name}</Link>
                    {e.isOverdue && <span className="df-pill df-danger">Overdue</span>}
                    {!e.isOverdue && e.doc.requestFrequency && (
                      <span className="df-pill df-warn">{e.doc.requestFrequency}</span>
                    )}
                  </div>
                  <div className="df-meta" style={{ marginTop: 4 }}>
                    {(() => {
                      const c = clients.find(cc => cc.id === e.doc.clientId);
                      return c ? (
                        <Link className="df-link" to={`/clients/${c.id}`}>{c.name}</Link>
                      ) : 'Unassigned';
                    })()}
                    {e.doc.folder && <> · {e.doc.folder}</>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <Link to={`/documents/${e.doc.id}`} className="df-btn df-sm df-ghost">
                      <I.Doc size={11} /> Open
                    </Link>
                    {e.doc.dueDate && (
                      <button
                        className="df-btn df-sm df-ghost"
                        onClick={() => onClearDueDate(e.doc.id, e.doc.name)}
                        title="Remove this fixed due date"
                      >
                        <I.X size={11} /> Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && !showAddForm && (
          <div style={{ marginTop: 14 }}>
            <button className="df-btn df-sm" onClick={onAddDeadline}>
              <I.Plus size={12} /> Add another
            </button>
          </div>
        )}

        {showAddForm && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              border: '1px solid var(--df-border)',
              borderRadius: 'var(--df-radius)',
              background: 'var(--df-panel-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="df-section-title" style={{ fontSize: 12.5 }}>
              Pin a document to {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="df-muted" style={{ fontSize: 11.5 }}>Client</span>
              <select
                className="df-input"
                value={addClientId}
                onChange={(e) => { setAddClientId(e.target.value); setAddDocId(''); }}
              >
                <option value="">— Select client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="df-muted" style={{ fontSize: 11.5 }}>Document</span>
              <select
                className="df-input"
                value={addDocId}
                onChange={(e) => setAddDocId(e.target.value)}
                disabled={!addClientId}
              >
                <option value="">{addClientId ? '— Select document —' : 'Pick a client first'}</option>
                {docsForAddClient.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="df-btn df-sm df-ghost" onClick={onCloseAddForm}>Cancel</button>
              <button className="df-btn df-sm df-primary" onClick={onConfirmAdd}>
                <I.Check size={12} /> Save
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default FinancialOverview;
