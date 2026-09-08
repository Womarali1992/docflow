/**
 * Everything the client's portal is working from, in one hook.
 *
 * A client has one or two engagements, not fifty, so their checklists are
 * fetched with the same per-engagement query the advisor's screens use — one
 * shared cache entry rather than a second endpoint answering the same question.
 * The documents come from the flat list, because a file uploaded before the
 * workflow model existed has no engagement to hang off and still belongs to the
 * person who sent it.
 */
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../client';
import type { Document, Engagement, RequestAttachment, RequestItem } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';
import { useEngagements } from './engagements';
import { useDocuments } from './documents';

/** How the portal sorts what is still owed. Lower comes first. */
export type StepBucket = 'needs_correction' | 'overdue' | 'due_soon' | 'open';

const DUE_SOON_DAYS = 14;

export interface PortalStep {
  request: RequestItem;
  engagement: Engagement | undefined;
  bucket: StepBucket;
}

const BUCKET_ORDER: Record<StepBucket, number> = {
  needs_correction: 0,
  overdue: 1,
  due_soon: 2,
  open: 3,
};

function bucketFor(request: RequestItem, now: number): StepBucket {
  if (request.status === 'needs_correction') return 'needs_correction';
  if (request.overdue) return 'overdue';
  if (request.dueDate && request.dueDate.getTime() - now <= DUE_SOON_DAYS * 86_400_000) return 'due_soon';
  return 'open';
}

export function useClientWork() {
  const scope = useScope();
  const signedIn = useSignedIn();
  const engagementsQuery = useEngagements();
  const documentsQuery = useDocuments();

  const engagements = useMemo(() => engagementsQuery.data ?? [], [engagementsQuery.data]);

  const trees = useQueries({
    queries: engagements.map((e) => ({
      queryKey: keys.engagement(scope, e.id),
      queryFn: () => api.engagements.get(e.id),
      enabled: signedIn,
    })),
  });

  const treesKey = trees.map((t) => t.dataUpdatedAt).join('|');

  return useMemo(() => {
    const documents = documentsQuery.data ?? [];
    const requests = trees.flatMap((t) => t.data?.requests ?? []).filter((r) => !r.archivedAt);
    const engagementById = new Map(engagements.map((e) => [e.id, e]));

    const now = Date.now();
    const done = requests.filter((r) => r.status === 'accepted' || r.status === 'waived');
    const withAdvisor = requests.filter((r) => r.status === 'submitted' || r.status === 'in_review');
    const outstanding = requests.filter((r) => r.status === 'requested' || r.status === 'needs_correction');

    const steps: PortalStep[] = outstanding
      .map((request) => ({
        request,
        engagement: engagementById.get(request.engagementId),
        bucket: bucketFor(request, now),
      }))
      .sort((a, b) => {
        const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
        if (byBucket !== 0) return byBucket;
        // Then by deadline: a dated item ahead of an undated one.
        const ad = a.request.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        const bd = b.request.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return a.request.sortOrder - b.request.sortOrder;
      });

    return {
      engagements,
      requests,
      documents,
      /* What the client can act on now, in the order they should act. */
      steps,
      /* Sent, and waiting on the accountant — nothing for the client to do. */
      withAdvisor: withAdvisor.map((request) => ({
        request,
        engagement: engagementById.get(request.engagementId),
      })),
      uploads: documents.filter((d) => d.kind !== 'deliverable'),
      shared: documents.filter((d) => d.kind === 'deliverable'),
      progress: { done: done.length, total: requests.length },
      isPending: engagementsQuery.isPending || documentsQuery.isPending || trees.some((t) => t.isPending),
      /**
       * The files filed against one line (H5). They ride on the request itself
       * now — the portal used to build a `Map<requestId, Document>` from the
       * tree's documents, which silently kept only the last one when a line had
       * several.
       */
      attachmentsFor: (requestId: string): RequestAttachment[] =>
        requests.find((r) => r.id === requestId)?.attachments ?? [],
    };
    // `treesKey` stands in for the per-engagement query results, which are new
    // array identities on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagements, documentsQuery.data, documentsQuery.isPending, engagementsQuery.isPending, treesKey]);
}
