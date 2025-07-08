
export interface Message {
  id: string;
  sender: string;
  role: 'advisor' | 'client';
  content: string;
  timestamp: Date;
}

export interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: Date;
  folder: string;
}

export interface Activity {
  id: string;
  type: 'message' | 'document' | 'update';
  description: string;
  timestamp: Date;
  user: string;
}

export type UserRole = 'advisor' | 'client';
