import React from 'react';
import type { UploadItem } from './useUploadQueue';
import { I } from '@/components/docflow/icons';

/**
 * The queue, visible.
 *
 * Every row says one of four things a person can act on: it is going, it is
 * with your accountant, it is being checked, or it failed *for this reason*.
 * A failure never removes the item — the file is still in hand, so "Try again"
 * is one tap rather than a second trip through the file picker.
 */

const STATE_PILL: Record<UploadItem['state'], { label: string; cls: string } | null> = {
  queued: { label: 'Waiting', cls: 'df-plain' },
  uploading: null,
  scanning: { label: 'Being checked', cls: 'df-warn' },
  done: { label: 'Sent', cls: 'df-ok' },
  failed: { label: 'Did not send', cls: 'df-danger' },
  cancelled: { label: 'Cancelled', cls: 'df-plain' },
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

interface Props {
  items: UploadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClearFinished: () => void;
}

const UploadQueue: React.FC<Props> = ({ items, onCancel, onRetry, onRemove, onClearFinished }) => {
  if (items.length === 0) return null;
  const finished = items.filter((it) => it.state === 'done' || it.state === 'scanning' || it.state === 'cancelled');

  return (
    <div className="df-queue" aria-live="polite">
      <div className="df-queue-head">
        <span className="df-field-label" style={{ margin: 0 }}>
          {items.length} file{items.length === 1 ? '' : 's'}
        </span>
        {finished.length > 0 && (
          <button className="df-btn df-sm df-ghost" onClick={onClearFinished}>Clear finished</button>
        )}
      </div>

      {items.map((item) => {
        const pill = STATE_PILL[item.state];
        return (
          <div key={item.id} className="df-queue-item">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="df-queue-name">{item.name}</div>
              <div className="df-meta">{formatBytes(item.size)}</div>

              {item.state === 'uploading' && (
                <div
                  className="df-progress"
                  style={{ marginTop: 6 }}
                  role="progressbar"
                  aria-valuenow={Math.round(item.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Sending ${item.name}`}
                >
                  <span className="df-progress-fill" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                </div>
              )}

              {item.message && <div className="df-small df-muted" style={{ marginTop: 6 }}>{item.message}</div>}
            </div>

            <div className="df-queue-actions">
              {item.state === 'uploading' && (
                <span className="df-mono df-small df-muted">{Math.round(item.progress * 100)}%</span>
              )}
              {pill && <span className={'df-pill ' + pill.cls}>{pill.label}</span>}

              {(item.state === 'queued' || item.state === 'uploading') && (
                <button className="df-btn df-sm df-ghost" onClick={() => onCancel(item.id)}>Cancel</button>
              )}
              {(item.state === 'failed' || item.state === 'cancelled') && (
                <>
                  <button className="df-btn df-sm" onClick={() => onRetry(item.id)}>
                    <I.Refresh size={12} /> Try again
                  </button>
                  <button className="df-icon-btn" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
                    <I.X size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default UploadQueue;
