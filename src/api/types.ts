// Types mirroring the server schema (see server/src/db/schema.ts).
// Dates are deserialized from ISO strings into Date objects by the API client.

export type RequestFrequency = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'one-time';
export type DocumentStatus = 'pending' | 'reviewed' | 'needs_update' | 'in_review';
export type ActorKind = 'provider' | 'client';

export interface Provider {
  id: string;
  name: string;
  email: string;
  firmName?: string | null;
}

export interface Client {
  id: string;
  providerId: string;
  name: string;
  email: string;
  accountId: string;
  plan?: string | null;
  clientSince?: string | null;
  aum?: number | null;
  pendingUpdates: number;
  unreadMessages: number;
  documentsCount: number;
  lastActivity: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  clientId: string;
  providerId: string;
  name: string;
  type?: string | null;
  size?: string | null;
  folder?: string | null;
  url?: string | null;
  /** True when bytes are stored for this document; the storage path itself never leaves the server. */
  hasFile: boolean;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedByKind?: ActorKind | null;
  uploadedById?: string | null;
  uploadedAt: Date;
  isRequested: boolean;
  requestedById?: string | null;
  requestedAt?: Date | null;
  description?: string | null;
  requestFrequency?: RequestFrequency | null;
  dueDate?: Date | null;
  hasUpdateRequest: boolean;
  updateRequestedById?: string | null;
  updateRequestedAt?: Date | null;
  updateRequestDescription?: string | null;
  requestedVersion?: string | null;
  status?: DocumentStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  clientId: string;
  providerId: string;
  documentId?: string | null;
  senderKind: ActorKind;
  senderId: string;
  senderName: string;
  content: string;
  readAt?: Date | null;
  createdAt: Date;
}

export type ActivityType = 'document' | 'message' | 'update';

export interface Activity {
  id: string;
  providerId: string;
  clientId?: string | null;
  type: ActivityType;
  description: string;
  actorKind?: ActorKind | null;
  actorId?: string | null;
  actorName?: string | null;
  targetId?: string | null;
  createdAt: Date;
}

export interface Preset {
  id: string;
  providerId: string;
  name: string;
  bins: { id: string; label: string; items: { name: string }[] }[];
  createdAt: Date;
  updatedAt: Date;
}

export type Me =
  | { kind: 'provider'; id: string; name: string; email: string; firmName?: string | null }
  | { kind: 'client';   id: string; name: string; email: string; providerId: string; providerName?: string | null };
