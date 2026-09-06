import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useClientWork } from '@/api/queries/portal';
import { I } from '@/components/docflow/icons';
import RequestCard from '@/components/docflow/portal/RequestCard';
import { clientRequestState } from '@/components/docflow/portal/requestState';
import { SkeletonRows } from '@/components/docflow/Skeleton';

/**
 * Your next steps.
 *
 * The whole portal is built around one question — *what do I have to do?* — so
 * this page answers it in order: what came back needing a fix, what is late,
 * what is due soon, then everything else still open. Anything already sent is
 * below the fold under "with your accountant", where it is reassurance rather
 * than a task.
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
  const { done, total } = work.progress;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

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

      {total > 0 && (
        <div className="df-section">
          <div className="df-section-body">
            <div className="df-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="df-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="df-meta" style={{ marginTop: 6 }}>
              <span className="df-mono">{done}</span> of <span className="df-mono">{total}</span> settled by your
              accountant{done === total ? ' — everything is in.' : ''}
            </div>
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
            {work.withAdvisor.map(({ request, answer }) => {
              const state = clientRequestState(request, answer);
              return (
                <div key={request.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{request.title}</div>
                    <div className="df-meta">
                      {state.note ?? (answer ? `You sent ${answer.displayName ?? answer.name}` : 'Sent')}
                    </div>
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
