import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { useUpdateClient, useUpdateEngagement } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { Client, Engagement } from '@/api/types';

/**
 * Editing what was typed when a client or an engagement was created.
 *
 * The PATCH routes and hooks existed from the start; nothing on screen called
 * them, so a misspelled name or a wrong tax year could only be fixed in psql
 * (2026-10-28 audit). Status still moves only through its own verbs —
 * deactivate, close, reopen — and these dialogs never touch it.
 */

export const EditClientDialog: React.FC<{ open: boolean; onClose: () => void; client: Client }> = ({ open, onClose, client }) => {
  const { toast } = useToast();
  const update = useUpdateClient();
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);

  useEffect(() => {
    if (open) {
      setName(client.name);
      setEmail(client.email);
    }
  }, [open, client.name, client.email]);

  const changed = name.trim() !== client.name || email.trim() !== client.email;
  const canSave = Boolean(name.trim() && email.trim().includes('@') && changed);

  const save = async () => {
    if (!canSave || update.isPending) return;
    try {
      const patch: { name?: string; email?: string } = {};
      if (name.trim() !== client.name) patch.name = name.trim();
      if (email.trim() !== client.email) patch.email = email.trim();
      await update.mutateAsync({ id: client.id, patch });
      toast({ title: 'Client updated', description: name.trim() });
      onClose();
    } catch (err) {
      toast({ title: 'Could not save', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit client"
      subtitle={client.name}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={onClose} disabled={update.isPending}>Cancel</button>
          <button className="df-btn df-primary" onClick={save} disabled={!canSave || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">Full name</span>
          <input className="df-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="df-field">
          <span className="df-field-label">Email</span>
          <input className="df-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="df-small df-muted">
            They sign in with this address, and notices go to it. Their password and authenticator stay as they are.
          </span>
        </label>
      </div>
    </Modal>
  );
};

export const EditEngagementDialog: React.FC<{ open: boolean; onClose: () => void; engagement: Engagement }> = ({
  open,
  onClose,
  engagement,
}) => {
  const { toast } = useToast();
  const update = useUpdateEngagement();
  const [title, setTitle] = useState(engagement.title);
  const [year, setYear] = useState(engagement.taxYear ? String(engagement.taxYear) : '');

  useEffect(() => {
    if (open) {
      setTitle(engagement.title);
      setYear(engagement.taxYear ? String(engagement.taxYear) : '');
    }
  }, [open, engagement.title, engagement.taxYear]);

  const parsedYear = year.trim() ? Number(year) : null;
  const yearValid = parsedYear === null || (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2200);
  const changed = title.trim() !== engagement.title || parsedYear !== (engagement.taxYear ?? null);
  const canSave = Boolean(title.trim()) && yearValid && changed;

  const save = async () => {
    if (!canSave || update.isPending) return;
    try {
      await update.mutateAsync({ id: engagement.id, patch: { title: title.trim(), taxYear: parsedYear } });
      toast({ title: 'Engagement updated', description: title.trim() });
      onClose();
    } catch (err) {
      toast({ title: 'Could not save', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit engagement"
      subtitle={engagement.title}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={onClose} disabled={update.isPending}>Cancel</button>
          <button className="df-btn df-primary" onClick={save} disabled={!canSave || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">Title</span>
          <input className="df-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="df-field">
          <span className="df-field-label">Tax year <span className="df-muted">(optional)</span></span>
          <input className="df-input df-mono" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
          {!yearValid && <span className="df-small" style={{ color: 'var(--df-danger)' }}>Enter a four-digit year, or leave it empty.</span>}
        </label>
      </div>
    </Modal>
  );
};
