
import { Message, Document, Activity } from '@/types/dashboard';

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

export const mockDocuments: Document[] = [
  {
    id: '1',
    name: 'Q3_Portfolio_Analysis.pdf',
    type: 'pdf',
    size: '2.4 MB',
    uploadedBy: 'John Smith',
    uploadedAt: new Date(2024, 6, 7, 9, 0),
    folder: 'Reports'
  },
  {
    id: '2',
    name: 'Bank_Statement_June.pdf',
    type: 'pdf',
    size: '890 KB',
    uploadedBy: 'Sarah Johnson',
    uploadedAt: new Date(2024, 6, 5, 14, 30),
    folder: 'Statements'
  },
  {
    id: '3',
    name: 'Investment_Contract_Amendment.docx',
    type: 'docx',
    size: '156 KB',
    uploadedBy: 'John Smith',
    uploadedAt: new Date(2024, 6, 3, 16, 20),
    folder: 'Contracts'
  }
];

export const mockActivities: Activity[] = [
  {
    id: '1',
    type: 'document',
    description: 'Q3 Portfolio Analysis uploaded',
    timestamp: new Date(2024, 6, 7, 9, 0),
    user: 'John Smith'
  },
  {
    id: '2',
    type: 'message',
    description: 'New message received',
    timestamp: new Date(2024, 6, 7, 11, 15),
    user: 'Sarah Johnson'
  },
  {
    id: '3',
    type: 'update',
    description: 'Portfolio rebalancing recommendations',
    timestamp: new Date(2024, 6, 6, 15, 45),
    user: 'System'
  }
];
