import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useClient, useCloseEngagement, useEngagement, useReopenEngagement } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '@/components/docflow/icons';
import MessagesPanel from '@/components/docflow/MessagesPanel';
import Checklist from '@/components/docflow/engagement/Checklist';
import Deliverables from '@/components/docflow/engagement/Deliverables';
import Uploads from '@/components/docflow/engagement/Uploads';

/**
 * The engagement workspace — one piece of work, start to finish.
 *
 * The whole screen is one request (`GET /engagements/:id` returns the
 * engagement, its checklist and its documents together), so a thirty-line
 * checklist costs one round trip rather than thirty-one, and every count on
 * the page is consistent with every other because they came from one read.
 */

const KIND_LABEL: Record<string, string> = {
  individual_tax: 'Individual tax',
  business_tax: 'Business tax',
  other: 'Other work',
  imported: 'Imported',
};

type Tab = 'checklist' | 'uploads' | 'deliverables';

const Engagement: React.FC = () => {
  const { engagementId } = useParams<{ engagementId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, error } = useEngagement(engagementId);
  const closeEngagement = useCloseEngagement();
  const reopenEngagement = useReopenEngagement();
  const [tab, setTab] = useState<Tab>('checklist');

  const client = useClient(data?.engagement.clientId);

  const { deliverables, uploads } = useMemo(() => {
    const docs = data?.documents ?? [];
    return {
      deliverables: docs.filter((d) => d.kind === 'deliverable'),
      uploads: docs.filter((d) => d.kind !== 'deliverable'),
    };
  }, [data]);

  if (isPending) {
    return <div className="df-page"><div className="df-empty">Loading engagement…</div></div>;
  }
  if (error || !data) {
    return (
      <div className="df-page">
        <div className="df-empty">
          That engagement is not on your file.{' '}
          <button className="df-link" onClick={() => navigate('/clients')}>Back to clients</button>
        </div>
      </div>
    );
  }

  const { engagement, requests } = data;
  const closed = engagement.status === 'closed';
  const busy = closeEngagement.isPending || reopenEngagement.isPending;

  const toReview = requests.filter((r) => r.status === 'submitted' || r.status === 'in_review').length;
  const withClient = requests.filter((r) => r.status === 'requested' || r.status === 'needs_correction').length;
  const overdue = requests.filter((r) => r.overdue).length;
  const needsDecision = requests.filter(
    (r) => Boolean(r.clientResponseKind) && r.status !== 'accepted' && r.status !== 'waived'
  ).length;

  const toggleStatus = async () => {
    try {
      if (closed) {
        await reopenEngagement.mutateAsync(engagement.id);
        toast({ title: 'Engagement reopened', description: engagement.title });
      } else {
        await closeEngagement.mutateAsync(engagement.id);
        toast({ title: 'Engagement closed', description: 'It stays on the file and can be reopened.' });
      }
    } catch (err) {
      toast({ title: 'Could not change the engagement', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'checklist', label: 'Checklist', count: requests.length },
    { id: 'uploads', label: 'Client uploads', count: uploads.length },
    { id: 'deliverables', label: 'Deliverables', count: deliverables.length },
  ];

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div className="df-client-switcher">
          <button
            className="df-icon-btn"
            aria-label="Back to the client"
            onClick={() => navigate(`/clients/${engagement.clientId}`)}
          >
            <I.ChevronL size={14} />
          </button>
          <div>
            <h1 className="df-client-name">{engagement.title}</h1>
            <div className="df-client-meta">
              <button className="df-link" onClick={() => navigate(`/clients/${engagement.clientId}`)}>
                {client.data?.name ?? 'Client'}
              </button>
              <span className="df-dot-sep" />
              <span>{KIND_LABEL[engagement.kind] ?? engagement.kind}</span>
              {engagement.taxYear ? (
                <>
                  <span className="df-dot-sep" />
                  <span className="df-mono">{engagement.taxYear}</span>
                </>
              ) : null}
              <span className="df-dot-sep" />
              <span className={closed ? 'df-pill df-plain' : 'df-pill df-ok'}>{closed ? 'Closed' : 'Open'}</span>
            </div>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-ghost" onClick={toggleStatus} disabled={busy}>
            {closed ? <><I.Refresh size={13} /> Reopen</> : <><I.Check size={13} /> Close engagement</>}
          </button>
        </div>
      </div>

      <div className="df-kpi-strip">
        <Kpi label="To review" value={toReview} tone={toReview > 0 ? 'df-info' : undefined} hint="Client has sent something" />
        <Kpi label="With the client" value={withClient} tone={withClient > 0 ? 'df-warn' : undefined} hint="Waiting on them" />
        <Kpi label="Overdue" value={overdue} tone={overdue > 0 ? 'df-danger' : undefined} hint="Past the due date" />
        <Kpi label="Needs decision" value={needsDecision} tone={needsDecision > 0 ? 'df-warn' : undefined} hint="“I don’t have this”" />
      </div>

      <div className="df-two-col">
        <div style={{ minWidth: 0 }}>
          <div className="df-seg" role="tablist" style={{ marginBottom: 12 }}>
            {tabs.map((t) => (
              <button key={t.id} className={tab === t.id ? 'df-active' : ''} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
                {t.label} <span className="df-mono" style={{ opacity: 0.6 }}>{t.count}</span>
              </button>
            ))}
          </div>

          {tab === 'checklist' && (
            <Checklist
              engagementId={engagement.id}
              engagementTitle={engagement.title}
              closed={closed}
              requests={requests}
              documents={data.documents}
            />
          )}
          {tab === 'uploads' && <Uploads documents={uploads} requests={requests} />}
          {tab === 'deliverables' && <Deliverables engagementId={engagement.id} closed={closed} documents={deliverables} />}
        </div>

        <MessagesPanel
          clientId={engagement.clientId}
          meKind="provider"
          subtitle={client.data ? `With ${client.data.name}` : 'Thread'}
        />
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number; hint: string; tone?: string }> = ({ label, value, hint, tone }) => (
  <div className="df-kpi">
    <div className="df-kpi-label">{label}</div>
    <div className="df-kpi-value df-mono">{value}</div>
    <div className={'df-kpi-trend ' + (value > 0 ? (tone ?? '') : '')}>
      <span className={value > 0 ? undefined : 'df-muted'}>{hint}</span>
    </div>
  </div>
);

export default Engagement;
