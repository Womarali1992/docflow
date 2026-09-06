/**
 * Documents, their versions and the decisions made about them.
 *
 * Files are immutable: replacing one is a new version, never an overwrite
 * (invariant 2). That is why there is `useUploadVersion` and no "replace file"
 * — the shape of the API here is the shape of the guarantee.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { Document, Review, UploadResult, VersionWithReviews } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';

export interface DocumentListParams {
  clientId?: string;
  engagementId?: string;
  kind?: 'client_upload' | 'deliverable' | 'imported';
  includeArchived?: boolean;
}

export function useDocuments(params: DocumentListParams = {}) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Document[]>({
    queryKey: keys.documentList(scope, params as Record<string, unknown>),
    queryFn: () => api.documents.list(params),
    enabled: signedIn,
  });
}

export function useDocument(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Document>({
    queryKey: keys.document(scope, id ?? 'none'),
    queryFn: () => api.documents.get(id!),
    enabled: signedIn && Boolean(id),
  });
}

/** Newest first, each version carrying the decision made about that version. */
export function useDocumentVersions(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<VersionWithReviews[]>({
    queryKey: keys.documentVersions(scope, id ?? 'none'),
    queryFn: () => api.versions.list(id!),
    enabled: signedIn && Boolean(id),
  });
}

export function useDocumentReviews(id: string | undefined) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useQuery<Review[]>({
    queryKey: keys.documentReviews(scope, id ?? 'none'),
    queryFn: () => api.documents.reviews(id!),
    enabled: signedIn && Boolean(id),
  });
}

function useDocumentMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, idOf: (input: TInput) => string) {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_result, input) => {
      // The document prefix covers the row, its versions and its reviews.
      queryClient.invalidateQueries({ queryKey: keys.document(scope, idOf(input)) });
      queryClient.invalidateQueries({ queryKey: keys.documents(scope) });
      queryClient.invalidateQueries({ queryKey: keys.engagements(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}

/** A new version supersedes the previous one and sends the request back for review. */
export function useUploadVersion() {
  return useDocumentMutation<{ id: string; file: File }, UploadResult>(
    (input) => api.uploads.newVersion(input.id, input.file),
    (input) => input.id
  );
}

/** An ad-hoc file into an engagement: a deliverable from the advisor, an upload from the client. */
export function useUploadToEngagement() {
  const queryClient = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (input: { engagementId: string; file: File }) => api.uploads.toEngagement(input.engagementId, input.file),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: keys.engagement(scope, input.engagementId) });
      queryClient.invalidateQueries({ queryKey: keys.documents(scope) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
    },
  });
}

/** Decisions on an ad-hoc upload; one answering a request is decided on the request. */
export function useAcceptDocument() {
  return useDocumentMutation<{ id: string; versionId?: string; note?: string }, Document>(
    (input) => api.documents.accept(input.id, { versionId: input.versionId, note: input.note }),
    (input) => input.id
  );
}

export function useRequestDocumentCorrection() {
  return useDocumentMutation<{ id: string; note: string; versionId?: string }, Document>(
    (input) => api.documents.requestCorrection(input.id, { note: input.note, versionId: input.versionId }),
    (input) => input.id
  );
}

/** The moment a deliverable becomes visible to the client. Confirm before calling it. */
export function useShareDocument() {
  return useDocumentMutation<string, Document>((id) => api.documents.share(id), (id) => id);
}

export function useUnshareDocument() {
  return useDocumentMutation<string, Document>((id) => api.documents.unshare(id), (id) => id);
}

/** Archive, never delete: the bytes stay, the row leaves the default lists. */
export function useArchiveDocument() {
  return useDocumentMutation<string, Document>((id) => api.documents.archive(id), (id) => id);
}

export function useUnarchiveDocument() {
  return useDocumentMutation<string, Document>((id) => api.documents.unarchive(id), (id) => id);
}
