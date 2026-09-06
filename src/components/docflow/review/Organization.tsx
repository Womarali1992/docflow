import React, { useEffect, useState } from 'react';
import type { Document, Engagement } from '@/api/types';
import { useUpdateDocument } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';

/**
 * Where this document is filed: what it is called, what it counts as, and which
 * engagement it belongs to.
 *
 * Renaming changes the display name only — the file the client sent keeps its
 * own filename on every version, so the advisor's tidying can never be mistaken
 * for the client having sent something different.
 */
interface Props {
  document: Document;
  engagements: Engagement[];
}

const Organization: React.FC<Props> = ({ document: doc, engagements }) => {
  const { toast } = useToast();
  const update = useUpdateDocument();

  const [displayName, setDisplayName] = useState(doc.displayName ?? doc.name);
  const [category, setCategory] = useState(doc.category ?? '');
  const [engagementId, setEngagementId] = useState(doc.engagementId ?? '');

  // Follow the server when the row changes underneath (another tab, a new version).
  useEffect(() => {
    setDisplayName(doc.displayName ?? doc.name);
    setCategory(doc.category ?? '');
    setEngagementId(doc.engagementId ?? '');
  }, [doc.id, doc.displayName, doc.name, doc.category, doc.engagementId]);

  const dirty =
    displayName.trim() !== (doc.displayName ?? doc.name) ||
    category.trim() !== (doc.category ?? '') ||
    engagementId !== (doc.engagementId ?? '');

  const save = async () => {
    if (!displayName.trim()) return;
    try {
      await update.mutateAsync({
        id: doc.id,
        patch: {
          displayName: displayName.trim(),
          category: category.trim() || null,
          engagementId: engagementId || null,
        },
      });
      toast({ title: 'Filing updated', description: displayName.trim() });
    } catch (err) {
      toast({ title: 'Could not update the filing', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Filing</div>
          <div className="df-section-sub">Name, category and engagement</div>
        </div>
        {dirty && (
          <div className="df-right">
            <button className="df-btn df-sm df-primary" onClick={save} disabled={update.isPending || !displayName.trim()}>
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <div className="df-section-body">
        <div className="df-form">
          <label className="df-field">
            <span className="df-field-label">Display name</span>
            <input className="df-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <span className="df-small df-muted">The file keeps its own name on every version.</span>
          </label>
          <div className="df-form-row">
            <label className="df-field">
              <span className="df-field-label">Category</span>
              <input className="df-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Income" />
            </label>
            <label className="df-field">
              <span className="df-field-label">Engagement</span>
              <select className="df-input" value={engagementId} onChange={(e) => setEngagementId(e.target.value)}>
                <option value="">Not filed against an engagement</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                    {e.status === 'closed' ? ' (closed)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Organization;
