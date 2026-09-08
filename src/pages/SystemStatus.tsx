import React from 'react';
import { useOpsStatus, useRetryJob } from '@/api/queries';
import type { FailedJob } from '@/api/types';
import { I } from '@/components/docflow/icons';
import { SkeletonRows } from '@/components/docflow/Skeleton';
import LoadError from '@/components/docflow/LoadError';

/**
 * System status — the page an accountant opens when something feels wrong, and
 * the one they should glance at on a Monday.
 *
 * Ordered by what cannot be recovered from later: the backup first, then the
 * worker (while it is down, nothing queued happens at all), then the scanner
 * (while it is down, uploads arrive but stay closed), then the disk, then
 * anything stuck. Every row that is not fine says what to do about it in a
 * sentence, because the person reading this is a CPA, not an administrator, and
 * the runbook is in a different window.
 *
 * The failed-job list is the one place the panel does something rather than
 * reporting: most failures are one email sent while the mail password was
 * wrong, and Retry should not mean opening a database client (H7).
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

/** A waiting time, said the way somebody would say it out loud. */
const duration = (seconds: number) => {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
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

/**
 * The jobs that gave up, with the one button that does something about them.
 *
 * The error text is shown as the server truncated it. It is the firm's own
 * background task failing — usually SMTP saying no — and hiding it behind
 * "an error occurred" would leave the only actionable thing on the page unsaid.
 */
const FailedJobs: React.FC<{ jobs: FailedJob[] }> = ({ jobs }) => {
  const retry = useRetryJob();
  const [retried, setRetried] = React.useState<string[]>([]);

  if (jobs.length === 0) return null;
  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Failed jobs</div>
          <div className="df-section-sub">
            {jobs.length} job{jobs.length === 1 ? '' : 's'} used up every attempt and stopped
          </div>
        </div>
      </div>
      <div className="df-list">
        {jobs.map((job) => (
          <div key={job.id} className="df-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div>
                <span className="df-mono">{job.type}</span>
                <span className="df-muted">
                  {' '}· gave up after {job.attempts} attempt{job.attempts === 1 ? '' : 's'} · {formatWhen(job.runAt)}
                </span>
              </div>
              {job.lastError && <div className="df-note df-note-warn">{job.lastError}</div>}
            </div>
            <button
              className="df-btn"
              disabled={retry.isPending || retried.includes(job.id)}
              onClick={() => retry.mutate(job.id, { onSuccess: () => setRetried((ids) => [...ids, job.id]) })}
            >
              {retried.includes(job.id) ? 'Queued' : 'Retry'}
            </button>
          </div>
        ))}
      </div>
      {retry.isError && (
        <div className="df-section-body">
          <div className="df-note df-note-warn">
            That job could not be retried — refresh the page; it may have started running on its own.
          </div>
        </div>
      )}
    </div>
  );
};

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
              label="Background worker"
              ok={data.worker.lastSeenAt !== null && !data.worker.note}
              value={
                data.worker.lastSeenAt === null ? (
                  'Never started'
                ) : (
                  <>
                    {data.worker.note ? 'Not answering' : 'Running'}
                    <span className="df-muted">
                      {' '}· last heard from{' '}
                      {data.worker.silentSeconds !== null && data.worker.silentSeconds < 90
                        ? 'just now'
                        : `${duration(data.worker.silentSeconds ?? 0)} ago`}
                    </span>
                    <div className="df-meta">
                      <span className="df-mono">{data.worker.workerId}</span>
                      {data.worker.host && <span className="df-muted"> on {data.worker.host}</span>}
                      {data.worker.version && <span className="df-muted"> · build {data.worker.version}</span>}
                      {data.worker.startedAt && <span className="df-muted"> · up since {formatWhen(data.worker.startedAt)}</span>}
                    </div>
                  </>
                )
              }
              note={data.worker.note}
            />

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
                  {data.jobs.oldestActionableAgeSeconds !== null && (
                    <div className="df-meta df-muted">
                      Oldest job that is due has been waiting {duration(data.jobs.oldestActionableAgeSeconds)}
                    </div>
                  )}
                </>
              }
              note={
                data.jobs.failed > 0
                  ? 'A failed job has used up its attempts and will not run again on its own. Fix the cause, then Retry it below.'
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

            <Row
              label="This build"
              // A migration this build expects that the database has not taken
              // is the one thing here that is a real problem rather than a fact.
              ok={data.release.migrations.pending.length === 0 ? (data.release.dirty === true ? null : true) : false}
              value={
                <>
                  {data.release.short ? (
                    <>
                      <span className="df-mono">{data.release.short}</span>
                      {data.release.branch && <span className="df-muted"> on {data.release.branch}</span>}
                      {data.release.dirty && <span className="df-muted"> · built from an edited working tree</span>}
                    </>
                  ) : (
                    <span className="df-muted">Running from source, not from a build</span>
                  )}
                  <div className="df-meta df-muted">
                    node {data.release.node}
                    {data.release.builtAt && <> · built {formatWhen(data.release.builtAt)}</>}
                    {' '}· <span className="df-mono">{data.release.migrations.applied}</span> migration
                    {data.release.migrations.applied === 1 ? '' : 's'} applied
                    {data.release.scanner && <> · {data.release.scanner}</>}
                  </div>
                </>
              }
              note={
                data.release.migrations.pending.length > 0
                  ? `This build expects ${data.release.migrations.pending.length} migration(s) the database has not taken: ${data.release.migrations.pending.join(', ')}.`
                  : data.release.note
              }
            />
          </div>
        )}
      </div>

      {data && <FailedJobs jobs={data.jobs.failedList} />}
    </div>
  );
};

export default SystemStatus;
