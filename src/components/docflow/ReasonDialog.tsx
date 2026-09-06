import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { getErrorMessage } from '@/utils/errors';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** What the text is for, in the words of the person who will read it. */
  label: string;
  help?: string;
  placeholder?: string;
  confirmLabel: string;
  /** Rejecting with an error keeps the dialog open and shows the message. */
  onConfirm: (reason: string) => Promise<unknown>;
}

/**
 * Asks for the sentence that has to exist before an action is allowed: the note
 * a client will read as "fix this", the reason a waived line carries for the
 * rest of the file's life.
 *
 * The server refuses both of those empty (`note_required`, `reason_required`),
 * so the button here is disabled until something is typed — the rule is not
 * being invented in the browser, it is being made visible.
 */
const ReasonDialog: React.FC<Props> = ({ open, onClose, title, subtitle, label, help, placeholder, confirmLabel, onConfirm }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      subtitle={subtitle}
      width={480}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="df-btn df-primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">{label}</span>
          <textarea
            className="df-input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
          {help && <span className="df-small df-muted">{help}</span>}
        </label>
        {error && <div className="df-small" style={{ color: 'var(--df-danger)' }}>{error}</div>}
      </div>
    </Modal>
  );
};

export default ReasonDialog;
