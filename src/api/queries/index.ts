/**
 * The data layer (C3.1). Screens import from here, never from `@/api/client`
 * directly, so caching, polling and invalidation stay in one place.
 *
 * Two rules the screens above this line rely on:
 *   - Every scoped key starts with the signed-in identity, and is disabled
 *     while nobody is signed in (see `keys.ts`).
 *   - Background refreshes carry `X-DocFlow-Poll: 1` and do not extend the
 *     session (see `live.ts`).
 */
export { keys, scopeOf, ANON, type Scope, type ThreadRef } from './keys';
export { POLL, isRefresh, useLiveQuery } from './live';

export { useMe, useScope, useSignedIn, useSessions, useMfaStatus, useChangePassword, useRegenerateRecoveryCodes } from './auth';
export {
  useClients,
  useClient,
  useCreateClient,
  useUpdateClient,
  useInviteClient,
  useClientResetLink,
  useDeactivateClient,
  useReactivateClient,
} from './clients';
export {
  useEngagements,
  useEngagement,
  useCreateEngagement,
  useUpdateEngagement,
  useCloseEngagement,
  useReopenEngagement,
  useAddRequests,
} from './engagements';
export {
  useRequest,
  useUpdateRequest,
  useAcceptRequest,
  useRequestCorrection,
  useWaiveRequest,
  useReopenRequest,
  useRespondToRequest,
  useUploadToRequest,
} from './requests';
export {
  useDocuments,
  useDocument,
  useDocumentVersions,
  useDocumentReviews,
  useRefreshDocument,
  useUpdateDocument,
  useUploadVersion,
  useUploadToEngagement,
  useAcceptDocument,
  useRequestDocumentCorrection,
  useShareDocument,
  useUnshareDocument,
  useArchiveDocument,
  useUnarchiveDocument,
  type DocumentListParams,
} from './documents';
export { useMessages, useSendMessage, useMarkThreadRead } from './messages';
export { useActivities } from './activities';
export { useNotifications, useMarkNotificationsRead } from './notifications';
export { useDashboard } from './dashboard';
export { useSearch } from './search';
export { useTemplates, useTemplate, useCreateTemplate, useUpdateTemplate, useArchiveTemplate } from './templates';
export { useOpsStatus, useRetryJob } from './ops';
