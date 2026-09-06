import React, { useState } from 'react';
import Modal from '../Modal';
import { I } from '../icons';
import { useAddRequests, useTemplates } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { TemplateItem } from '@/api/types';

interface Props {
  open: boolean;
  onClose: () => void;
  engagementId: string;
  engagementTitle: string;
}

/**
 * Adds lines to a checklist, from a template or typed straight in.
 *
 * Both forms append rather than replace — applying a second template to an
 * engagement must not renumber lines the client has already been answering.
 * The server enforces "exactly one of templateId or items"; this dialog just
 * makes the choice visible.
 */
const AddItemsDialog: React.FC<Props> = ({ open, onClose, engagementId, engagementTitle }) => {
  const { toast } = useToast();
  const addRequests = useAddRequests();
  const { data: templates = [] } = useTemplates();

  const [mode, setMode] = useState<'template' | 'typed'>('template');
  const [templateId, setTemplateId] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const close = () => {
    setText('');
    setTemplateId('');
    setCategory('');
    setDueDate('');
    onClose();
  };

  const canSubmit = mode === 'template' ? Boolean(templateId) : lines.length > 0;

  const submit = async () => {
    if (!canSubmit || addRequests.isPending) return;
    const due = dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null;
    try {
      const items: TemplateItem[] = lines.map((title, i) => ({
        key: `typed-${Date.now()}-${i}`,
        title,
        category: category.trim() || null,
        required: true,
      }));
      const created = await addRequests.mutateAsync({
        id: engagementId,
        input: mode === 'template' ? { templateId, dueDate: due } : { items, dueDate: due },
      });
      toast({ title: 'Items added', description: `${created.length} item${created.length === 1 ? '' : 's'} added to ${engagementTitle}.` });
      close();
    } catch (err) {
      toast({ title: 'Could not add the items', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add checklist items"
      subtitle={engagementTitle}
      width={520}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={close} disabled={addRequests.isPending}>Cancel</button>
          <button className="df-btn df-primary" onClick={submit} disabled={!canSubmit || addRequests.isPending}>
            <I.Plus size={12} /> {addRequests.isPending ? 'Adding…' : 'Add items'}
          </button>
        </>
      }
    >
      <div className="df-form">
        <div className="df-seg" role="tablist">
          <button className={mode === 'template' ? 'df-active' : ''} onClick={() => setMode('template')}>From a template</button>
          <button className={mode === 'typed' ? 'df-active' : ''} onClick={() => setMode('typed')}>Type them in</button>
        </div>

        {mode === 'template' ? (
          <label className="df-field">
            <span className="df-field-label">Template</span>
            <select className="df-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a checklist…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.items.length} item{t.items.length === 1 ? '' : 's'}</option>
              ))}
            </select>
            {templates.length === 0 && <span className="df-small df-muted">No templates yet — build one under Templates.</span>}
          </label>
        ) : (
          <>
            <label className="df-field">
              <span className="df-field-label">One item per line</span>
              <textarea
                className="df-input"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'W-2\n1099-INT from the bank\nMortgage interest statement'}
                autoFocus
              />
              <span className="df-small df-muted">{lines.length} item{lines.length === 1 ? '' : 's'} · you can add instructions to each afterwards.</span>
            </label>
            <label className="df-field">
              <span className="df-field-label">Category for all of them <span className="df-muted">(optional)</span></span>
              <input className="df-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Income" />
            </label>
          </>
        )}

        <label className="df-field">
          <span className="df-field-label">Due date <span className="df-muted">(optional)</span></span>
          <input className="df-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <span className="df-small df-muted">
            {mode === 'template'
              ? 'Overrides each item’s own offset from the template.'
              : 'Applies to every line added here.'}
          </span>
        </label>
      </div>
    </Modal>
  );
};

export default AddItemsDialog;
