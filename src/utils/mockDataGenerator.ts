import { Document, RequestFrequency, Client, Message, Activity } from '@/types/dashboard';
import { DOCUMENT_FOLDERS } from '@/constants/app';
import { generateDocumentId } from '@/utils/documentUtils';

interface DocumentTemplate {
  name: string;
  type: string;
  size: string;
  folder: string;
  frequency?: RequestFrequency;
  hasUrl?: boolean;
}

interface RecurringDocumentConfig {
  template: DocumentTemplate;
  clientId: string;
  startYear: number;
  endYear: number;
  frequency: RequestFrequency;
  hasReceived?: string[]; // Array of versions that have been received
}

/**
 * Generate a single document from a template
 */
const generateDocument = (
  template: DocumentTemplate,
  uploadedBy: string,
  uploadedAt: Date,
  clientId: string,
  overrides: Partial<Document> = {}
): Document => {
  return {
    id: generateDocumentId(),
    name: template.name,
    type: template.type,
    size: template.size,
    uploadedBy,
    uploadedAt,
    folder: template.folder,
    clientId,
    url: template.hasUrl ? `#mock-${template.name.toLowerCase().replace(/\s+/g, '-').replace(/\.\w+$/, '')}` : undefined,
    requestFrequency: template.frequency,
    ...overrides,
  };
};

/**
 * Generate recurring documents (monthly, quarterly, yearly)
 */
const generateRecurringDocuments = (config: RecurringDocumentConfig): Document[] => {
  const documents: Document[] = [];
  const { template, clientId, startYear, endYear, frequency, hasReceived = [] } = config;

  for (let year = startYear; year <= endYear; year++) {
    if (frequency === 'yearly') {
      const version = year.toString();
      const isReceived = hasReceived.includes(version);
      const documentName = isReceived ? `${template.name} ${version}.${template.type}` : template.name;
      
      documents.push(generateDocument(
        { ...template, name: documentName, hasUrl: isReceived },
        isReceived ? 'Sarah Johnson' : '',
        isReceived ? new Date(year, 2, 15) : new Date(),
        clientId,
        {
          isRequested: true,
          requestedBy: 'John Smith',
          requestedAt: new Date(2024, 6, 8, 12, 0),
          description: `Annual ${template.name.toLowerCase()} for portfolio planning`,
          requestFrequency: frequency,
          requestedVersion: version,
          size: isReceived ? template.size : '',
          uploadedBy: isReceived ? 'Sarah Johnson' : '',
        }
      ));
    } else if (frequency === 'quarterly') {
      for (let quarter = 1; quarter <= 4; quarter++) {
        const version = `Q${quarter} ${year}`;
        const isReceived = hasReceived.includes(version);
        const documentName = isReceived ? `${template.name} ${version}.${template.type}` : template.name;
        
        documents.push(generateDocument(
          { ...template, name: documentName, hasUrl: isReceived },
          isReceived ? 'Sarah Johnson' : '',
          isReceived ? new Date(year, (quarter - 1) * 3, 15) : new Date(),
          clientId,
          {
            isRequested: true,
            requestedBy: 'John Smith',
            requestedAt: new Date(2024, 6, 8, 12, 0),
            description: 'Quarterly financial reports and analysis',
            requestFrequency: frequency,
            requestedVersion: version,
            size: isReceived ? template.size : '',
            uploadedBy: isReceived ? 'Sarah Johnson' : '',
          }
        ));
      }
    } else if (frequency === 'monthly') {
      for (let month = 1; month <= 12; month++) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const version = `${monthNames[month - 1]} ${year}`;
        const isReceived = hasReceived.includes(version);
        const documentName = isReceived ? `${template.name} ${year} ${shortMonthNames[month - 1]}.${template.type}` : template.name;
        
        documents.push(generateDocument(
          { ...template, name: documentName, hasUrl: isReceived },
          isReceived ? 'Sarah Johnson' : '',
          isReceived ? new Date(year, month - 1, 15) : new Date(),
          clientId,
          {
            isRequested: true,
            requestedBy: 'John Smith',
            requestedAt: new Date(2024, 6, 8, 12, 0),
            description: 'Monthly bank statements for cash flow analysis',
            requestFrequency: frequency,
            requestedVersion: version,
            size: isReceived ? template.size : '',
            uploadedBy: isReceived ? 'Sarah Johnson' : '',
          }
        ));
      }
    }
  }

  return documents;
};

/**
 * Generate mock clients
 */
export const generateMockClients = (): Client[] => [
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

/**
 * Generate mock documents
 */
export const generateMockDocuments = (): Document[] => {
  const documents: Document[] = [];

  // Static documents with proper time variations
  const staticDocuments: Document[] = [
    generateDocument(
      { name: 'Q3 Portfolio Analysis 2025.pdf', type: 'pdf', size: '2.4 MB', folder: DOCUMENT_FOLDERS.REPORTS, hasUrl: true },
      'John Smith',
      new Date(2025, 8, 15, 9, 0), // September 2025
      '1',
      { requestFrequency: 'quarterly' }
    ),
    generateDocument(
      { name: 'Bank Statement June 2029.pdf', type: 'pdf', size: '890 KB', folder: DOCUMENT_FOLDERS.STATEMENTS, hasUrl: true },
      'Sarah Johnson',
      new Date(2029, 5, 30, 14, 30), // June 2029
      '1',
      { requestFrequency: 'monthly' }
    ),
    generateDocument(
      { name: 'Investment Contract Amendment.docx', type: 'docx', size: '156 KB', folder: DOCUMENT_FOLDERS.CONTRACTS },
      'John Smith',
      new Date(2024, 6, 3, 16, 20), // One-time document, no date variation needed
      '2'
    ),
    generateDocument(
      { name: 'Tax Returns 2024.pdf', type: 'pdf', size: '2.8 MB', folder: DOCUMENT_FOLDERS.DOCUMENTS, hasUrl: true },
      'Sarah Johnson',
      new Date(2024, 2, 15, 14, 30),
      '1',
      {
        hasUpdateRequest: true,
        updateRequestedBy: 'John Smith',
        updateRequestedAt: new Date(2024, 6, 8, 10, 0),
        updateRequestDescription: 'Please upload your complete tax returns for 2024 including all schedules and supporting documents.',
        requestedVersion: '2024',
        requestFrequency: 'yearly',
      }
    )
  ];

  documents.push(...staticDocuments);

  // Generate recurring documents
  const recurringConfigs: RecurringDocumentConfig[] = [
    {
      template: { name: 'Financial Report', type: 'pdf', size: '1.2 MB', folder: DOCUMENT_FOLDERS.REPORTS },
      clientId: '1',
      startYear: 2024,
      endYear: 2025,
      frequency: 'quarterly',
      hasReceived: ['Q1 2024', 'Q2 2024', 'Q4 2024', 'Q2 2025']
    },
    {
      template: { name: 'Tax Returns', type: 'pdf', size: '2.8 MB', folder: DOCUMENT_FOLDERS.DOCUMENTS },
      clientId: '1',
      startYear: 2024,
      endYear: 2025,
      frequency: 'yearly',
      hasReceived: ['2024']
    },
    {
      template: { name: 'Bank Statements', type: 'pdf', size: '890 KB', folder: DOCUMENT_FOLDERS.STATEMENTS },
      clientId: '1',
      startYear: 2024,
      endYear: 2025,
      frequency: 'monthly',
      hasReceived: ['January 2024', 'February 2024', 'March 2024', 'April 2024', 'May 2024', 'June 2024', 'October 2024', 'January 2025', 'March 2025', 'April 2025', 'May 2025', 'June 2025']
    }
  ];

  recurringConfigs.forEach(config => {
    documents.push(...generateRecurringDocuments(config));
  });

  return documents;
};

/**
 * Generate mock messages
 */
export const generateMockMessages = (): Message[] => [
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

/**
 * Generate mock activities
 */
export const generateMockActivities = (): Activity[] => [
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
