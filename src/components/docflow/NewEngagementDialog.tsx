import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import { I } from './icons';
import { useAddRequests, useCreateEngagement, useTemplates } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { Engagement, EngagementKind } from '@/api/types';

const KINDS: { value: EngagementKind; label: string; noun: string }[] = [
  { value: 'individual_tax', label: 'Individual tax return', noun: 'Individual Tax Return' },
  { value: 'business_tax', label: 'Business tax return', noun: 'Business Tax Return' },
  { value: 'other', label: 'Other work', noun: 'Engagement' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName?: string;
  onCreated?: (engagement: Engagement) => void;
}

/**
 * Starts an engagement, and — because an empty checklist helps nobody — offers
 * to fill it from a template in the same step.
 *
 * The two calls are deliberately not one: if the checklist fails to apply, the
 * engagement still exists and the advisor is told to add items rather than
 * losing the engagement they just named.
 */
const NewEngagementDialog: React.FC<Props> = ({ open, onClose, clientId, clientName, onCreated }) => {
  const { toast } = useToast();
  const createEngagement = useCreateEngagement();
  const addRequests = useAddRequests();
  const { data: templates = [] } = useTemplates();

  const thisYear = new Date().getFullYear();
  const [kind, setKind] = useState<EngagementKind>('individual_tax');
  const [year, setYear] = useState<string>(String(thisYear - 1));
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  /** What the engagement is called if the advisor does not rename it. */
  const suggestedTitle = useMemo(() => {
    const noun = KINDS.find((k) => k.value === kind)?.noun ?? 'Engagement';
    return year.trim() ? `${year.trim()} ${noun}` : noun;
  }, [kind, year]);

  const effectiveTitle = title.trim() || suggestedTitle;
  const parsedYear = year.trim() ? Number(year) : null;
  const yearValid = parsedYear === null || (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200);

  const close = () => {
    setTitle('');
    setTemplateId('');
    setDueDate('');
    onClose();
  };

  const submit = async () => {
    if (busy || !yearValid) return;
    setBusy(true);
    try {
      const engagement = await createEngagement.mutateAsync({
        clientId,
        title: effectiveTitle,
        kind,
        taxYear: parsedYear,
      });

      if (templateId) {
        try {
          const created = await addRequests.mutateAsync({
            id: engagement.id,
            input: { templateId, dueDate: dueDate ? new Date(dueDate).toISOString() : null },
          });
          toast({ title: 'Engagement started', description: `${effectiveTitle} · ${created.length} item${created.length === 1 ? '' : 's'} requested.` });
        } catch (err) {
          toast({
            title: 'Engagement started, checklist not applied',
            description: `${getErrorMessage(err)} You can add items from the engagement.`,
            variant: 'destructive',
          });
        }
      } else {
        toast({ title: 'Engagement started', description: effectiveTitle });
      }

      close();
      onCreated?.(engagement);
    } catch (err) {
      toast({ title: 'Could not start the engagement', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New engagement"
      subtitle={clientName ? `For ${clientName}` : undefined}
      width={520}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={close} disabled={busy}>Cancel</button>
          <button className="df-btn df-primary" onClick={submit} disabled={busy || !yearValid}>
            <I.Plus size={12} /> {busy ? 'Starting…' : 'Start engagement'}
          </button>
        </>
      }
    >
      <div className="df-form">
        <div className="df-form-row">
          <label className="df-field">
            <span className="df-field-label">Kind</span>
            <select className="df-input" value={kind} onChange={(e) => setKind(e.target.value as EngagementKind)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="df-field">
            <span className="df-field-label">Tax year <span className="df-muted">(optional)</span></span>
            <input
              className="df-input df-mono"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder={String(thisYear - 1)}
            />
          </label>
        </div>

        <label className="df-field">
          <span className="df-field-label">Title</span>
          <input className="df-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggestedTitle} autoFocus />
          {!title.trim() && <span className="df-small df-muted">Will be called “{suggestedTitle}”.</span>}
        </label>

        <label className="df-field">
          <span className="df-field-label">Checklist <span className="df-muted">(optional)</span></span>
          <select className="df-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Start empty — add items later</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.items.length} item{t.items.length === 1 ? '' : 's'}</option>
            ))}
          </select>
        </label>

        {templateId && (
          <label className="df-field">
            <span className="df-field-label">Due date for every item <span className="df-muted">(optional)</span></span>
            <input className="df-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <span className="df-small df-muted">Leave empty to use each item’s own offset from the template.</span>
          </label>
        )}

        {!yearValid && <div className="df-small" style={{ color: 'var(--df-danger)' }}>Enter a four-digit year, or leave it empty.</div>}
      </div>
    </Modal>
  );
};

export default NewEngagementDialog;
