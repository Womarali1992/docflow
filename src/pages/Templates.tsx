import React, { useEffect, useMemo, useState } from 'react';
import { useArchiveTemplate, useCreateTemplate, useTemplates, useUpdateTemplate } from '@/api/queries';
import type { RequestTemplate, TemplateItem, TemplateKind } from '@/api/types';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '@/components/docflow/icons';
import Modal from '@/components/docflow/Modal';

/**
 * Checklist templates — the list the advisor asks for every January, written
 * once.
 *
 * Two starter checklists are seeded by the server on a firm's first visit here,
 * so the screen is never empty and nobody has to invent "1099-INT" from a blank
 * page. Editing one never rewrites an engagement already built from it: those
 * engagements hold their own copies of the lines, and archiving a template
 * leaves last year's file exactly as it was.
 */

const KIND_LABEL: Record<TemplateKind, string> = {
  individual_tax: 'Individual tax',
  business_tax: 'Business tax',
  custom: 'Custom',
};

/** Stable per-item key; the engagement rows carry it as `templateItemKey`. */
const keyFor = (title: string, index: number) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) || 'item'}-${index}`;

const emptyItem = (index: number): TemplateItem => ({
  key: keyFor('new item', index),
  title: '',
  category: null,
  instructions: null,
  required: true,
});

const Templates: React.FC = () => {
  const { toast } = useToast();
  const { data: templates = [], isPending } = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const archiveTemplate = useArchiveTemplate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateKind>('custom');
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<RequestTemplate | null>(null);

  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId]);

  // Open the first template once the list arrives; leave the choice alone after that.
  useEffect(() => {
    if (!selectedId && templates.length > 0) setSelectedId(templates[0].id);
  }, [templates, selectedId]);

  // Load the selected template into the draft. A draft with unsaved edits is
  // never clobbered by a background refetch.
  useEffect(() => {
    if (!selected || dirty) return;
    setName(selected.name);
    setKind(selected.kind);
    setItems(selected.items ?? []);
  }, [selected, dirty]);

  const patchItem = (index: number, patch: Partial<TemplateItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    setDirty(true);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem(prev.length)]);
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const startNew = () => {
    setSelectedId(null);
    setName('New checklist');
    setKind('custom');
    setItems([emptyItem(0)]);
    setDirty(true);
  };

  const usable = items.filter((it) => it.title.trim().length > 0);
  const canSave = name.trim().length > 0 && usable.length > 0;

  const save = async () => {
    if (!canSave) return;
    // Keys have to be unique inside a template, and readable in an audit row.
    const payload = usable.map((it, i) => ({
      key: it.key && it.key.trim() && !it.key.startsWith('new-item') ? it.key : keyFor(it.title, i),
      title: it.title.trim(),
      category: it.category?.trim() ? it.category.trim() : null,
      instructions: it.instructions?.trim() ? it.instructions.trim() : null,
      required: it.required !== false,
      ...(it.dueOffsetDays !== undefined && it.dueOffsetDays !== null ? { dueOffsetDays: it.dueOffsetDays } : {}),
    }));

    try {
      if (selectedId) {
        await updateTemplate.mutateAsync({ id: selectedId, patch: { name: name.trim(), kind, items: payload } });
        toast({ title: 'Checklist saved', description: `${name.trim()} · ${payload.length} item${payload.length === 1 ? '' : 's'}` });
      } else {
        const created = await createTemplate.mutateAsync({ name: name.trim(), kind, items: payload });
        setSelectedId(created.id);
        toast({ title: 'Checklist created', description: `${created.name} · ${payload.length} item${payload.length === 1 ? '' : 's'}` });
      }
      setDirty(false);
    } catch (err) {
      toast({ title: 'Could not save the checklist', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const archive = async (template: RequestTemplate) => {
    try {
      await archiveTemplate.mutateAsync(template.id);
      setConfirmArchive(null);
      if (selectedId === template.id) {
        setSelectedId(null);
        setDirty(false);
      }
      toast({ title: 'Checklist archived', description: 'Engagements already built from it are untouched.' });
    } catch (err) {
      toast({ title: 'Could not archive', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const busy = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Templates</h1>
          <div className="df-client-meta">
            <span>{templates.length} checklist{templates.length === 1 ? '' : 's'}</span>
            <span className="df-dot-sep" />
            <span>Used to fill an engagement in one step</span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-primary" onClick={startNew}><I.Plus size={13} /> New checklist</button>
        </div>
      </div>

      <div className="df-grid-2-aside">
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">{selectedId ? 'Edit checklist' : 'New checklist'}</div>
              <div className="df-section-sub">
                {usable.length} item{usable.length === 1 ? '' : 's'}
                {dirty ? ' · unsaved changes' : ''}
              </div>
            </div>
            <div className="df-right" style={{ gap: 6 }}>
              <button className="df-btn df-sm" onClick={addItem}><I.Plus size={12} /> Add item</button>
              <button className="df-btn df-sm df-primary" onClick={save} disabled={!canSave || busy}>
                {busy ? 'Saving…' : selectedId ? 'Save changes' : 'Create checklist'}
              </button>
            </div>
          </div>

          <div className="df-section-body">
            <div className="df-form-row" style={{ marginBottom: 12 }}>
              <label className="df-field">
                <span className="df-field-label">Name</span>
                <input
                  className="df-input"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setDirty(true); }}
                  placeholder="e.g. Individual tax return"
                />
              </label>
              <label className="df-field">
                <span className="df-field-label">Kind</span>
                <select className="df-input" value={kind} onChange={(e) => { setKind(e.target.value as TemplateKind); setDirty(true); }}>
                  {(Object.keys(KIND_LABEL) as TemplateKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="df-list">
              {items.length === 0 && <div className="df-empty">No items yet. “Add item” starts the list.</div>}
              {items.map((item, index) => (
                <div key={index} className="df-row" style={{ gridTemplateColumns: 'auto 1fr auto', alignItems: 'flex-start', gap: 10 }}>
                  <div className="df-reorder">
                    <button className="df-icon-btn df-sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                      <I.ArrowUp size={12} />
                    </button>
                    <button className="df-icon-btn df-sm" aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                      <I.ArrowUp size={12} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                  </div>

                  <div className="df-form" style={{ gap: 6 }}>
                    <input
                      className="df-input"
                      value={item.title}
                      onChange={(e) => patchItem(index, { title: e.target.value })}
                      placeholder="What you need — e.g. W-2"
                    />
                    <input
                      className="df-input df-sm"
                      value={item.instructions ?? ''}
                      onChange={(e) => patchItem(index, { instructions: e.target.value })}
                      placeholder="Instructions the client reads (optional)"
                    />
                    <div className="df-form-row">
                      <input
                        className="df-input df-sm"
                        value={item.category ?? ''}
                        onChange={(e) => patchItem(index, { category: e.target.value })}
                        placeholder="Category (optional)"
                      />
                      <label className="df-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <span className="df-field-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>Due in</span>
                        <input
                          className="df-input df-sm df-mono"
                          inputMode="numeric"
                          style={{ width: 70 }}
                          value={item.dueOffsetDays ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const n = raw === '' ? undefined : Number(raw);
                            patchItem(index, { dueOffsetDays: n !== undefined && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined });
                          }}
                          placeholder="days"
                          aria-label="Default due offset in days"
                        />
                        <span className="df-small df-muted">days</span>
                      </label>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={item.required !== false}
                        onChange={(e) => patchItem(index, { required: e.target.checked })}
                      />
                      Required — an optional item is not chased
                    </label>
                  </div>

                  <button className="df-icon-btn" aria-label="Remove item" onClick={() => removeItem(index)}>
                    <I.X size={13} />
                  </button>
                </div>
              ))}
            </div>

            {!canSave && items.length > 0 && (
              <div className="df-small df-muted" style={{ marginTop: 8 }}>
                Give the checklist a name and at least one item with a title before saving.
              </div>
            )}
          </div>
        </div>

        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Your checklists</div>
              <div className="df-section-sub">Pick one to edit</div>
            </div>
          </div>
          <div className="df-list">
            {isPending && <div className="df-empty">Loading…</div>}
            {!isPending && templates.length === 0 && <div className="df-empty">No checklists yet.</div>}
            {templates.map((t) => (
              <div
                key={t.id}
                className={'df-row df-clickable' + (t.id === selectedId ? ' df-selected' : '')}
                style={{ gridTemplateColumns: '1fr auto' }}
                onClick={() => { setDirty(false); setSelectedId(t.id); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') { setDirty(false); setSelectedId(t.id); } }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{t.name}</div>
                  <div className="df-meta">{KIND_LABEL[t.kind]} · {t.items.length} item{t.items.length === 1 ? '' : 's'}</div>
                </div>
                <button
                  className="df-btn df-sm df-ghost"
                  onClick={(e) => { e.stopPropagation(); setConfirmArchive(t); }}
                  aria-label={`Archive ${t.name}`}
                >
                  <I.Trash size={12} /> Archive
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(confirmArchive)}
        onClose={() => setConfirmArchive(null)}
        title="Archive this checklist?"
        subtitle={confirmArchive?.name}
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setConfirmArchive(null)} disabled={archiveTemplate.isPending}>Keep it</button>
            <button className="df-btn df-primary" onClick={() => confirmArchive && archive(confirmArchive)} disabled={archiveTemplate.isPending}>
              {archiveTemplate.isPending ? 'Archiving…' : 'Archive'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>
          It stops appearing when you start an engagement. Engagements already built from it keep every line exactly as
          it was — nothing on a client's file changes.
        </div>
      </Modal>
    </div>
  );
};

export default Templates;
