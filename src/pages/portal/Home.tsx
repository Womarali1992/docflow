import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useClientWork } from '@/api/queries/portal';
import type { RequestItem } from '@/api/types';
import { I } from '@/components/docflow/icons';
import RequestCard from '@/components/docflow/portal/RequestCard';
import { clientRequestState } from '@/components/docflow/portal/requestState';
import { WithdrawableFiles } from '@/components/docflow/portal/WithdrawFile';
import { SkeletonRows } from '@/components/docflow/Skeleton';
import ChecklistTiles from '@/components/docflow/board/ChecklistTiles';
import MoveBar from '@/components/docflow/board/MoveBar';
import { revealLine } from '@/components/docflow/board/motion';
import { tally } from '@/components/docflow/board/whoseMove';
import { toneClass, toneOf } from '@/components/docflow/tone';

/**
 * Your next steps.
 *
 * The whole portal is built around one question — *what do I have to do?* — so
 * this page answers it in order: what came back needing a fix, what is late,
 * what is due soon, then everything else still open. Anything already sent is
 * below the fold under "with your accountant", where it is reassurance rather
 * than a task — and where a file sent by mistake can still be withdrawn.
 *
 * The counter is the accountant's counter: an item is done when they have
 * accepted it or agreed it is not needed, not when a file was uploaded.
 */
const PortalHome: React.FC = () => {
  const navigate = useNavigate();
  const { me } = useAuth();
  const work = useClientWork();

  const firstName = me?.name?.split(' ')[0] ?? 'there';
  const advisorName = me?.kind === 'client' ? me.providerName : null;
  const { total } = work.progress;

  /* The board is this page in miniature: the open work only, in the order the
     page lists it — your next steps, then what is with your accountant, then
     what is settled — so each column reads in the order of its section below. A
     closed year is finished business and has no tile. (`work.requests` arrives
     in checklist order, and the sort is stable, so settled lines keep it.) */
  const board = useMemo(() => {
    const openWork = new Set(work.engagements.filter((e) => e.status !== 'closed').map((e) => e.id));
    const place = new Map<string, number>();
    work.steps.forEach((s, i) => place.set(s.request.id, i));
    work.withAdvisor.forEach(({ request }, i) => place.set(request.id, work.steps.length + i));
    const last = Number.MAX_SAFE_INTEGER;
    return work.requests
      .filter((r) => openWork.has(r.engagementId))
      .sort((a, b) => (place.get(a.id) ?? last) - (place.get(b.id) ?? last));
  }, [work.engagements, work.requests, work.steps, work.withAdvisor]);
  const counts = tally(board);

  /* A line still on this page is scrolled to; a settled one lives on "All items". */
  const openLine = (request: RequestItem) => {
    if (!revealLine(`line-${request.id}`)) navigate('/portal/requests');
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Hello, {firstName}</h1>
          <div className="df-client-meta">
            {advisorName ? <span>Your accountant is {advisorName}</span> : <span>Your document portal</span>}
            <span className="df-dot-sep" />
            <span className="df-live">
              {work.steps.length === 0 ? 'Nothing needs you right now' : `${work.steps.length} thing${work.steps.length === 1 ? '' : 's'} to do`}
            </span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn" onClick={() => navigate('/portal/messages')}>
            <I.Msg size={13} /> Messages
          </button>
          <button className="df-btn df-primary" onClick={() => navigate('/portal/requests')}>
            <I.Inbox size={13} /> All items
          </button>
        </div>
      </div>

      {counts.total > 0 && (
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Your checklist</div>
              <div className="df-section-sub">
                <span className="df-mono">{counts.done}</span> of <span className="df-mono">{counts.total}</span> settled
                by your accountant{counts.done === counts.total ? ' — everything is in.' : ''}
              </div>
            </div>
          </div>
          <div className="df-section-body">
            {/* The columns below carry the counts, so the bar goes without its legend. */}
            <MoveBar tally={counts} perspective="client" legend={false} />
            <ChecklistTiles requests={board} perspective="client" label="Your checklist" onOpen={openLine} />
          </div>
        </div>
      )}

      <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Your next steps</div>
            <div className="df-section-sub">In the order worth doing them</div>
          </div>
        </div>
        <div className="df-section-body df-steps">
          {work.isPending && <SkeletonRows rows={3} label="Loading your next steps" />}
          {!work.isPending && work.steps.length === 0 && (
            <div className="df-empty">
              {total === 0
                ? 'Your accountant has not asked for anything yet. They will let you know when they do.'
                : 'Nothing needs you right now. Anything you have sent is below.'}
            </div>
          )}
          {work.steps.map((step) => (
            <RequestCard key={step.request.id} step={step} />
          ))}
        </div>
      </div>

      {work.withAdvisor.length > 0 && (
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">With your accountant</div>
              <div className="df-section-sub">Sent — nothing for you to do</div>
            </div>
          </div>
          <div className="df-list">
            {work.withAdvisor.map(({ request }) => {
              const state = clientRequestState(request, request.attachments);
              return (
                <div
                  key={request.id}
                  id={`line-${request.id}`}
                  className={`df-row ${toneClass(toneOf(request))}`}
                  style={{ gridTemplateColumns: '1fr auto' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{request.title}</div>
                    <div className="df-meta">
                      {state.note ??
                        (request.attachmentCount === 0
                          ? 'Sent'
                          : request.attachmentCount === 1
                            ? `You sent ${request.attachments[0].displayName}`
                            : `You sent ${request.attachmentCount} files`)}
                    </div>
                    <WithdrawableFiles request={request} />
                  </div>
                  <span className={'df-pill ' + state.cls}>{state.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {work.shared.length > 0 && (
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Shared with you</div>
              <div className="df-section-sub">{work.shared.length} document{work.shared.length === 1 ? '' : 's'} from your accountant</div>
            </div>
            <div className="df-right">
              <button className="df-btn df-sm" onClick={() => navigate('/portal/shared')}>Open all</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalHome;
