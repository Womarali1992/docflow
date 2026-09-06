import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients, useSearch } from '@/api/queries';
import { I } from './icons';

type Result =
  | { kind: 'client'; id: string; label: string; sub: string }
  | { kind: 'document'; id: string; label: string; sub: string }
  | { kind: 'request'; id: string; engagementId: string; label: string; sub: string };

/**
 * ⌘K. Clients come from the list already in the cache; documents and checklist
 * lines come from the server's search, which is the only thing that knows what
 * this user is allowed to find.
 */
const SearchPalette: React.FC = () => {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // One request per pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data: found } = useSearch({ q: open && debounced.length >= 2 ? debounced : undefined });

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const clientHits: Result[] = clients
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({ kind: 'client', id: c.id, label: c.name, sub: c.email }));

    const docHits: Result[] = (found?.documents ?? []).slice(0, 6).map((d) => ({
      kind: 'document',
      id: d.id,
      label: d.displayName ?? d.name,
      sub: d.kind === 'deliverable' ? 'Deliverable' : (d.category ?? 'Document'),
    }));

    const requestHits: Result[] = (found?.requests ?? []).slice(0, 4).map((r) => ({
      kind: 'request',
      id: r.id,
      engagementId: r.engagementId,
      label: r.title,
      sub: `Checklist · ${r.status.replace('_', ' ')}`,
    }));

    return [...clientHits, ...docHits, ...requestHits];
  }, [query, clients, found]);

  const go = (r: Result) => {
    setOpen(false);
    if (r.kind === 'client') navigate(`/clients/${r.id}`);
    else if (r.kind === 'document') navigate(`/review/${r.id}`);
    else navigate(`/engagements/${r.engagementId}`);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  };

  return (
    <>
      <div
        className="df-search"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}
      >
        <I.Search size={14} />
        <input placeholder="Search documents, clients…" readOnly value="" style={{ cursor: 'pointer' }} />
        <span className="df-kbd">⌘K</span>
      </div>

      {open && (
        <div className="df-root df-modal-overlay" style={{ alignItems: 'flex-start' }} onClick={() => setOpen(false)}>
          <div className="df-palette" onClick={(e) => e.stopPropagation()}>
            <div className="df-palette-input">
              <I.Search size={15} />
              <input
                ref={inputRef}
                placeholder="Clients, documents, checklist items…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
              />
              <span className="df-kbd">esc</span>
            </div>
            <div className="df-palette-list">
              {results.length === 0 ? (
                <div className="df-empty" style={{ padding: 20 }}>
                  {query.trim().length >= 2 ? 'No matches' : 'Type at least two letters'}
                </div>
              ) : (
                results.map((r, i) => (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className={'df-palette-item' + (i === active ? ' df-active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                  >
                    <span className="df-palette-ic">
                      {r.kind === 'client' ? <I.Users size={13} /> : r.kind === 'document' ? <I.Doc size={13} /> : <I.Inbox size={13} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="df-palette-label">{r.label}</span>
                      <span className="df-palette-sub">{r.sub}</span>
                    </span>
                    <span className="df-palette-kind">{r.kind}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SearchPalette;
