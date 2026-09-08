import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { RequestItem } from '@/api/types';
import { I } from '../icons';

/**
 * Moving between the files answering one checklist line (H5).
 *
 * A request holds any number of attachments — six receipts are six files — and
 * the review workspace is built around one document at a time. Rather than
 * rebuild it around a list, this walks the advisor through them: each
 * attachment is its own `/review/:documentId`, so the preview, the version
 * history and the thread all keep working exactly as they do for a single file,
 * and the URL still says which one is on screen.
 *
 * Nothing renders for a line with one attachment, which is every line that
 * existed before H5.
 */
interface Props {
  request: RequestItem;
  currentDocumentId: string;
}

const AttachmentSwitcher: React.FC<Props> = ({ request, currentDocumentId }) => {
  const navigate = useNavigate();
  const attachments = request.attachments;
  if (attachments.length <= 1) return null;

  const index = attachments.findIndex((a) => a.documentId === currentDocumentId);
  const go = (to: number) => navigate(`/review/${attachments[to].documentId}`);

  return (
    <div className="df-attachment-bar">
      <button
        className="df-icon-btn"
        aria-label="Previous attachment"
        disabled={index <= 0}
        onClick={() => go(index - 1)}
      >
        <I.ChevronL size={14} />
      </button>

      <div className="df-attachment-tabs">
        {attachments.map((attachment, at) => (
          <button
            key={attachment.documentId}
            className={'df-attachment-tab' + (at === index ? ' df-on' : '')}
            onClick={() => go(at)}
            title={attachment.displayName}
          >
            <span className="df-attachment-tab-name">{attachment.displayName}</span>
            {attachment.state === 'checking' && <span className="df-pill df-warn">Checking</span>}
          </button>
        ))}
      </div>

      <div className="df-meta" style={{ whiteSpace: 'nowrap' }}>
        {index >= 0 ? `${index + 1} of ${attachments.length}` : `${attachments.length} files`}
      </div>

      <button
        className="df-icon-btn"
        aria-label="Next attachment"
        disabled={index < 0 || index >= attachments.length - 1}
        onClick={() => go(index + 1)}
      >
        <I.ChevronR size={14} />
      </button>
    </div>
  );
};

export default AttachmentSwitcher;
