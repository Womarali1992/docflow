
export interface Message {
  id: string;
  sender: string;
  role: 'advisor' | 'client';
  content: string;
  timestamp: Date;
}

export type RequestFrequency = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'one-time';

export interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: Date;
  folder: string;
  url?: string;
  // Optional ownership
  clientId?: string;
  // Optional explicit due date that overrides computed schedule
  dueDate?: Date;
  isRequested?: boolean;
  requestedBy?: string;
  requestedAt?: Date;
  description?: string;
  requestFrequency?: RequestFrequency;
  // Fields for handling update requests
  hasUpdateRequest?: boolean;
  updateRequestedBy?: string;
  updateRequestedAt?: Date;
  updateRequestDescription?: string;
  requestedVersion?: string; // e.g., "2024" for Tax Returns 2024
}

export interface DocumentRequest {
  id: string;
  documentName: string;
  description?: string;
  requestedBy: string;
  requestedAt: Date;
  clientId: string;
  status: 'pending' | 'fulfilled';
  frequency: RequestFrequency;
}

export interface Activity {
  id: string;
  type: 'message' | 'document' | 'update';
  description: string;
  timestamp: Date;
  user: string;
}

export type UserRole = 'advisor' | 'client';

export interface Client {
  id: string;
  name: string;
  email: string;
  lastActivity: Date;
  documentsCount: number;
  pendingUpdates: number;
  unreadMessages: number;
}

// Presets for Documents Needed
export interface PresetBinItem {
  name: string;
}

export interface PresetBin {
  id: string;
  label: string;
  items: PresetBinItem[];
}

export interface DocumentPreset {
  id: string;
  name: string;
  bins: PresetBin[];
  createdAt: Date;
  updatedAt: Date;
}