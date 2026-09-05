import React, { useState } from 'react';
import Modal from './Modal';
import { I } from './icons';

export interface OneTimeLinkView {
  title: string;
  link: string;
  expiresAt: Date;
  hint: string;
}

/** Shows a one-time link (invitation or reset) once, with a copy button. */
const LinkModal: React.FC<{ value: OneTimeLinkView | null; onClose: () => void; doneLabel?: string }> = ({ value, onClose, doneLabel = 'Done' }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={value?.title ?? ''}
      subtitle={value ? `Expires ${value.expiresAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · works once` : undefined}
      footer={
        <>
          <button className="df-btn" onClick={copy}>{copied ? <><I.Check size={12} /> Copied</> : 'Copy link'}</button>
          <button className="df-btn df-primary" onClick={onClose}>{doneLabel}</button>
        </>
      }
    >
      {value && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            className="df-mono"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--df-border)',
              borderRadius: 8,
              background: 'var(--df-bg)',
              fontSize: 12,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {value.link}
          </div>
          <div className="df-muted" style={{ fontSize: 12 }}>{value.hint}</div>
        </div>
      )}
    </Modal>
  );
};

export default LinkModal;
