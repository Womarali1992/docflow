import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients } from '@/context/ClientsContext';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { I } from './icons';

type Result =
  | { kind: 'client'; id: string; label: string; sub: string }
  | { kind: 'document'; id: string; label: string; sub: string };

const SearchPalette: React.FC = () => {
  const navigate = useNavigate();
  const { clients } = useClients();
  const { documents } = useDocumentsStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const clientHits: Result[] = clients
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 6)
      .map((c) => ({ kind: 'client', id: c.id, label: c.name, sub: c.email }));
    const docHits: Result[] = documents
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((d) => ({ kind: 'document', id: d.id, label: d.name, sub: d.folder || 'Document' }));
    return [...clientHits, ...docHits];
  }, [query, clients, documents]);

  const go = (r: Result) => {
    setOpen(false);
    navigate(r.kind === 'client' ? `/clients/${r.id}` : `/documents/${r.id}`);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) go(results[active]); }
  };

  return (
    <>
      <div className="df-search" onClick={() => setOpen(true)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}>
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
                placeholder="Search clients and documents…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
              />
              <span className="df-kbd">esc</span>
            </div>
            <div className="df-palette-list">
              {results.length === 0 ? (
                <div className="df-empty" style={{ padding: 20 }}>No matches</div>
              ) : (
                results.map((r, i) => (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className={'df-palette-item' + (i === active ? ' df-active' : '')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                  >
                    <span className="df-palette-ic">{r.kind === 'client' ? <I.Users size={13} /> : <I.Doc size={13} />}</span>
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
