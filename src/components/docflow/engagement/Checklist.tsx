import React, { useMemo, useState } from 'react';
import type { EngagementDocument, RequestItem } from '@/api/types';
import { useUpdateRequest } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import ChecklistItem from './ChecklistItem';
import AddItemsDialog from './AddItemsDialog';

type Filter = 'all' | 'open' | 'to_review' | 'settled';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  open: 'With the client',
  to_review: 'To review',
  settled: 'Settled',
};

interface Props {
  engagementId: string;
  engagementTitle: string;
  /** A closed engagement is readable, and nothing on it can be edited. */
  closed: boolean;
  requests: RequestItem[];
  documents: EngagementDocument[];
}

/**
 * The checklist: what was asked for, what came back, and what is still owed.
 *
 * Ordering is the advisor's — the list is theirs to arrange, and the order is
 * what the client sees in the portal. Reordering renumbers the whole list
 * rather than swapping two values, because an imported checklist can arrive
 * with every `sortOrder` set to zero and swapping would do nothing at all.
 */
const Checklist: React.FC<Props> = ({ engagementId, engagementTitle, closed, requests, documents }) => {
  const { toast } = useToast();
  const updateRequest = useUpdateRequest();
  const [filter, setFilter] = useState<Filter>('all');
  const [addOpen, setAddOpen] = useState(false);

  const ordered = useMemo(
    () => [...requests].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()),
    [requests]
  );

  const documentByRequest = useMemo(() => {
    const map = new Map<string, EngagementDocument>();
    for (const d of documents) if (d.requestId) map.set(d.requestId, d);
    return map;
  }, [documents]);

  const counts = useMemo(() => {
    const open = ordered.filter((r) => r.status === 'requested' || r.status === 'needs_correction').length;
    const toReview = ordered.filter((r) => r.status === 'submitted' || r.status === 'in_review').length;
    const settled = ordered.filter((r) => r.status === 'accepted' || r.status === 'waived').length;
    return { all: ordered.length, open, toReview, settled };
  }, [ordered]);

  const visible = useMemo(() => {
    if (filter === 'open') return ordered.filter((r) => r.status === 'requested' || r.status === 'needs_correction');
    if (filter === 'to_review') return ordered.filter((r) => r.status === 'submitted' || r.status === 'in_review');
    if (filter === 'settled') return ordered.filter((r) => r.status === 'accepted' || r.status === 'waived');
    return ordered;
  }, [ordered, filter]);

  /** Moves one line and renumbers everything, so the result is unambiguous. */
  const move = async (id: string, direction: -1 | 1) => {
    const index = ordered.findIndex((r) => r.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;

    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];

    try {
      for (let i = 0; i < next.length; i += 1) {
        if (next[i].sortOrder !== i) {
          await updateRequest.mutateAsync({ id: next[i].id, patch: { sortOrder: i } });
        }
      }
    } catch (err) {
      toast({ title: 'Could not reorder the list', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div className="df-seg" role="tablist">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'df-active' : ''} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}{' '}
              <span className="df-mono" style={{ opacity: 0.6 }}>
                {f === 'all' ? counts.all : f === 'open' ? counts.open : f === 'to_review' ? counts.toReview : counts.settled}
              </span>
            </button>
          ))}
        </div>
        <div className="df-right">
          <button className="df-btn df-sm" onClick={() => setAddOpen(true)} disabled={closed}>
            <I.Plus size={12} /> Add items
          </button>
        </div>
      </div>

      <div className="df-list">
        {closed && (
          <div className="df-note">This engagement is closed. Reopen it to change the checklist.</div>
        )}
        {ordered.length === 0 && (
          <div className="df-empty">
            No items yet. “Add items” fills the checklist from a template, or you can type the list straight in.
          </div>
        )}
        {ordered.length > 0 && visible.length === 0 && <div className="df-empty">Nothing in this view.</div>}

        {visible.map((request) => {
          const index = ordered.findIndex((r) => r.id === request.id);
          return (
            <ChecklistItem
              key={request.id}
              request={request}
              answer={documentByRequest.get(request.id)}
              first={index === 0}
              last={index === ordered.length - 1}
              /* Reordering only makes sense against the whole list. */
              editable={!closed && filter === 'all'}
              onMove={(direction) => move(request.id, direction)}
            />
          );
        })}
      </div>

      <AddItemsDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        engagementId={engagementId}
        engagementTitle={engagementTitle}
      />
    </div>
  );
};

export default Checklist;
