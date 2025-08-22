
import { Message, Document, Activity, Client } from '@/types/dashboard';

export const mockMessages: Message[] = [
  {
    id: '1',
    sender: 'John Smith',
    role: 'advisor',
    content: 'Hi Sarah, I\'ve reviewed your portfolio performance for Q3. Overall looking strong with 8.2% growth. I\'d like to discuss some rebalancing opportunities.',
    timestamp: new Date(2024, 6, 7, 10, 30)
  },
  {
    id: '2',
    sender: 'Sarah Johnson',
    role: 'client',
    content: 'That\'s great news! I\'m available tomorrow afternoon to discuss. Should I prepare any specific documents?',
    timestamp: new Date(2024, 6, 7, 11, 15)
  },
  {
    id: '3',
    sender: 'John Smith',
    role: 'advisor',
    content: 'Perfect! Just bring your latest bank statements. I\'ll send over the portfolio analysis shortly.',
    timestamp: new Date(2024, 6, 7, 11, 45)
  }
];

export const mockClients: Client[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah.johnson@email.com',
    lastActivity: new Date(2024, 6, 7, 11, 15),
    documentsCount: 8,
    pendingUpdates: 2,
    unreadMessages: 3
  },
  {
    id: '2',
    name: 'Michael Chen',
    email: 'michael.chen@email.com',
    lastActivity: new Date(2024, 6, 6, 14, 30),
    documentsCount: 12,
    pendingUpdates: 0,
    unreadMessages: 1
  },
  {
    id: '3',
    name: 'Emily Davis',
    email: 'emily.davis@email.com',
    lastActivity: new Date(2024, 6, 5, 9, 45),
    documentsCount: 6,
    pendingUpdates: 1,
    unreadMessages: 0
  }
];

export const mockDocuments: Document[] = [
  {
    id: '1',
    name: 'Q3 Portfolio Analysis.pdf',
    type: 'pdf',
    size: '2.4 MB',
    uploadedBy: 'John Smith',
    uploadedAt: new Date(2024, 6, 7, 9, 0),
    folder: 'Reports',
    requestFrequency: 'quarterly',
    clientId: '1'
  },
  {
    id: '2',
    name: 'Bank Statement June.pdf',
    type: 'pdf',
    size: '890 KB',
    uploadedBy: 'Sarah Johnson',
    uploadedAt: new Date(2024, 6, 5, 14, 30),
    folder: 'Statements',
    requestFrequency: 'monthly',
    clientId: '1'
  },
  {
    id: '3',
    name: 'Investment Contract Amendment.docx',
    type: 'docx',
    size: '156 KB',
    uploadedBy: 'John Smith',
    uploadedAt: new Date(2024, 6, 3, 16, 20),
    folder: 'Contracts',
    clientId: '2'
  },
  {
    id: '4',
    name: 'Tax Returns 2023.pdf',
    type: 'pdf',
    size: '3.2 MB',
    uploadedBy: 'Sarah Johnson',
    uploadedAt: new Date(2024, 2, 15, 14, 30), // Uploaded in March
    folder: 'Documents',
    url: '/mock-tax-returns-2023.pdf',
    hasUpdateRequest: true,
    updateRequestedBy: 'John Smith',
    updateRequestedAt: new Date(2024, 6, 8, 10, 0),
    updateRequestDescription: 'Please upload your complete tax returns for 2024 including all schedules and supporting documents.',
    requestedVersion: '2024',
    requestFrequency: 'yearly',
    clientId: '1'
  },
  {
    id: '5',
    name: 'Insurance Policy Documents',
    type: 'pdf',
    size: '',
    uploadedBy: '',
    uploadedAt: new Date(),
    folder: 'Documents',
    isRequested: true,
    requestedBy: 'John Smith',
    requestedAt: new Date(2024, 6, 8, 11, 30),
    description: 'Current life and disability insurance policy documents for portfolio planning.',
    requestFrequency: 'yearly',
    clientId: '3'
  }
];

export const mockActivities: Activity[] = [
  {
    id: '1',
    type: 'document',
    description: 'Q3 Portfolio Analysis.pdf uploaded by John Smith',
    timestamp: new Date(2024, 6, 7, 9, 0),
    user: 'John Smith'
  },
  {
    id: '2',
    type: 'message',
    description: 'New message received from Sarah Johnson',
    timestamp: new Date(2024, 6, 7, 11, 15),
    user: 'Sarah Johnson'
  },
  {
    id: '3',
    type: 'update',
    description: 'Portfolio rebalancing recommendations updated',
    timestamp: new Date(2024, 6, 6, 15, 45),
    user: 'System'
  },
  {
    id: '4',
    type: 'document',
    description: 'Bank Statement June.pdf shared with advisor',
    timestamp: new Date(2024, 6, 5, 14, 30),
    user: 'Sarah Johnson'
  }
];
