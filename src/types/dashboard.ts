
// Base types
export type UserRole = 'advisor' | 'client';
export type RequestFrequency = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'one-time';
export type DocumentStatus = 'pending' | 'reviewed' | 'needs_update' | 'fulfilled';
export type ActivityType = 'message' | 'document' | 'update';

// Message interface
export interface Message {
  id: string;
  sender: string;
  role: UserRole;
  content: string;
  timestamp: Date;
  documentId?: string; // Optional link to document
}

// Document time period interface
export interface DocumentTimePeriod {
  id: string;
  documentId: string;
  period: string; // e.g., "2024-01" for January 2024, "2024-Q1" for Q1 2024, "2024" for year 2024
  periodType: RequestFrequency;
  isSelected: boolean;
  selectedAt?: Date;
}

// Main document interface
export interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: Date;
  folder: string;
  url?: string;
  clientId?: string;
  dueDate?: Date;
  
  // Request-related fields
  isRequested?: boolean;
  requestedBy?: string;
  requestedAt?: Date;
  description?: string;
  requestFrequency?: RequestFrequency;
  
  // Update request fields
  hasUpdateRequest?: boolean;
  updateRequestedBy?: string;
  updateRequestedAt?: Date;
  updateRequestDescription?: string;
  requestedVersion?: string;
  
  // Time periods for recurring documents
  selectedTimePeriods?: DocumentTimePeriod[];
}

export interface DocumentRequest {
  id: string;
  documentName: string;
  description?: string;
  requestedBy: string;
  requestedAt: Date;
  clientId: string;
  status: DocumentStatus;
  frequency: RequestFrequency;
}

export interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  timestamp: Date;
  user: string;
}

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