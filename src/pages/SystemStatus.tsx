import React from 'react';
import { useOpsStatus } from '@/api/queries';
import { I } from '@/components/docflow/icons';
import { SkeletonRows } from '@/components/docflow/Skeleton';
import LoadError from '@/components/docflow/LoadError';

/**
 * System status — the page an accountant opens when something feels wrong, and
 * the one they should glance at on a Monday.
 *
 * Ordered by what cannot be recovered from later: the backup first, then the
 * scanner (while it is down, uploads arrive but stay closed), then the disk,
 * then anything stuck. Every row that is not fine says what to do about it in
 * a sentence, because the person reading this is a CPA, not an administrator,
 * and the runbook is in a different window.
 */

const formatBytes = (n: number | null) => {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';

const ago = (iso: string | null) => {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${Math.floor(hours)} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

/** One line of the panel: a state, a fact, and — when it is not fine — advice. */
const Row: React.FC<{ label: string; ok: boolean | null; value: React.ReactNode; note?: string | null }> = ({
  label,
  ok,
  value,
  note,
}) => (
  <div className="df-row" style={{ gridTemplateColumns: '190px 1fr auto', alignItems: 'flex-start' }}>
    <span className="df-field-label" style={{ margin: 0 }}>{label}</span>
    <div style={{ minWidth: 0 }}>
      <div>{value}</div>
      {note && <div className="df-note df-note-warn">{note}</div>}
    </div>
    <span className={'df-pill ' + (ok === null ? 'df-plain' : ok ? 'df-ok' : 'df-warn')}>
      {ok === null ? 'unknown' : ok ? 'OK' : 'check'}
    </span>
  </div>
);

const SystemStatus: React.FC = () => {
  const { data, isPending, error, refetch, isFetching } = useOpsStatus();

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">System status</h1>
          <div className="df-client-meta">
            <span>Backups, virus scanner, disk and background work</span>
            {data && (
              <>
                <span className="df-dot-sep" />
                <span>Firm time zone: <span className="df-mono">{data.firmTimezone}</span></span>
              </>
            )}
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn" onClick={() => refetch()} disabled={isFetching}>
            <I.Refresh size={13} className={isFetching ? 'df-spin' : undefined} /> Refresh
          </button>
        </div>
      </div>

      <div className="df-section">
        {isPending && <SkeletonRows rows={5} label="Loading system status" />}
        {error && !isPending && <LoadError what="the system status" onRetry={() => refetch()} />}

        {data && (
          <div className="df-list">
            <Row
              label="Last good backup"
              ok={Boolean(data.backups.lastGoodAt) && !data.backups.note}
              value={
                <>
                  {formatWhen(data.backups.lastGoodAt)}
                  {data.backups.lastGoodAt && <span className="df-muted"> · {ago(data.backups.lastGoodAt)}</span>}
                  {data.backups.lastGoodFiles !== null && (
                    <span className="df-muted">
                      {' '}· {data.backups.lastGoodFiles} file{data.backups.lastGoodFiles === 1 ? '' : 's'},{' '}
                      {formatBytes(data.backups.lastGoodDumpBytes)} database
                    </span>
                  )}
                </>
              }
              note={data.backups.note}
            />
            {data.backups.lastRunOk === false && (
              <Row label="Last attempt" ok={false} value="Failed" note={data.backups.lastError ?? 'See the backup log.'} />
            )}

            <Row
              label="Virus scanner"
              ok={data.scanner.required ? data.scanner.reachable && !data.scanner.note : null}
              value={
                <>
                  {!data.scanner.required
                    ? 'Switched off'
                    : data.scanner.reachable
                      ? 'Answering'
                      : 'Not answering'}
                  <span className="df-muted"> · <span className="df-mono">{data.scanner.endpoint}</span></span>
                  {data.scanner.signaturesAt && (
                    <span className="df-muted"> · signatures {ago(data.scanner.signaturesAt)}</span>
                  )}
                </>
              }
              note={data.scanner.note}
            />

            <Row
              label="Document storage"
              ok={data.storage.freeBytes === null ? null : !data.storage.note}
              value={
                <>
                  {formatBytes(data.storage.freeBytes)} free of {formatBytes(data.storage.totalBytes)}
                  <div className="df-meta df-mono">{data.storage.path}</div>
                </>
              }
              note={data.storage.note}
            />

            <Row
              label="Background jobs"
              ok={data.jobs.failed === 0}
              value={
                <>
                  <span className="df-mono">{data.jobs.pending}</span> pending ·{' '}
                  <span className="df-mono">{data.jobs.failed}</span> failed ·{' '}
                  <span className="df-mono">{data.jobs.done}</span> done
                </>
              }
              note={
                data.jobs.failed > 0
                  ? 'Failed jobs are kept, never retried and never deleted. They are usually email with the wrong credentials.'
                  : null
              }
            />

            <Row
              label="Uploads in progress"
              ok={data.health.unpublishedVersions === 0}
              value={
                <>
                  <span className="df-mono">{data.health.unpublishedVersions}</span> stuck over an hour ·{' '}
                  <span className="df-mono">{data.health.quarantinedVersions}</span> quarantined
                </>
              }
              note={
                data.health.unpublishedVersions > 0
                  ? 'These stored bytes but never finished being checked. The hourly sweeper flags them; if the count keeps rising, the scanner is the place to look.'
                  : null
              }
            />

            <Row
              label="Signed in now"
              ok={null}
              value={
                <>
                  <span className="df-mono">{data.health.activeSessions}</span> live session
                  {data.health.activeSessions === 1 ? '' : 's'}
                  <span className="df-muted"> · sessions end after 30 minutes idle, 12 hours at most</span>
                </>
              }
            />

            <Row
              label="Email"
              ok={data.mail.configured}
              value={data.mail.configured ? 'Configured' : 'Not configured — invitations are copy-link only'}
              note={data.mail.note}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemStatus;
