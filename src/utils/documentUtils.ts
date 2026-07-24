import { RequestFrequency, Document, DocumentTimePeriod } from '@/types/dashboard';
import { STATUS_COLORS, FREQUENCY_COLORS } from '@/constants/app';

/**
 * Get the CSS classes for a document status badge
 */
export const getStatusBadgeColor = (status: string): string => {
  return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.pending;
};

/**
 * Get the CSS classes for a frequency badge
 */
export const getFrequencyColor = (frequency: RequestFrequency): string => {
  return FREQUENCY_COLORS[frequency];
};

/**
 * Infer request frequency from a label string
 */
export const inferFrequencyFromLabel = (label: string): RequestFrequency => {
  const normalizedLabel = label.toLowerCase();
  
  if (normalizedLabel.includes('day')) return 'daily';
  if (normalizedLabel.includes('month')) return 'monthly';
  if (normalizedLabel.includes('quarter')) return 'quarterly';
  if (normalizedLabel.includes('year')) return 'yearly';
  if (normalizedLabel.includes('one')) return 'one-time';
  
  return 'one-time';
};

/**
 * Calculate the next due date based on upload date and frequency
 */
export const getNextDueDate = (uploadedAt: Date, frequency?: RequestFrequency): Date | null => {
  if (!frequency || frequency === 'one-time') return null;
  
  const nextDate = new Date(uploadedAt);
  
  switch (frequency) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
    default:
      return null;
  }
  
  return nextDate;
};

/**
 * Extract version from document name (e.g., "2024" from "Tax Returns 2024")
 */
export const extractVersionFromName = (documentName: string): string | undefined => {
  const versionMatch = documentName.match(/\b(19|20)\d{2}\b/);
  return versionMatch ? versionMatch[0] : undefined;
};

/**
 * Check if two document names represent the same document type
 */
export const isSameDocumentType = (existingName: string, requestedName: string): boolean => {
  const normalize = (name: string) => name.toLowerCase().replace(/\.[^/.]+$/, ''); // Remove extension
  
  const existingBaseName = normalize(existingName);
  const requestedBaseName = normalize(requestedName);
  
  // Check for similar base names
  const existingWords = existingBaseName.split(' ').filter(word => word.length > 2);
  const requestedWords = requestedBaseName.split(' ').filter(word => word.length > 2);
  
  // If most significant words match, consider it the same document type
  const matchingWords = existingWords.filter(word => requestedWords.includes(word));
  return matchingWords.length >= Math.min(2, Math.max(existingWords.length, requestedWords.length) * 0.6);
};

/**
 * Format time period for display
 */
export const formatTimePeriod = (period: string, frequency: RequestFrequency): string => {
  switch (frequency) {
    case 'monthly':
      const monthMatch = period.match(/(\d{4})-(\d{2})/);
      if (monthMatch) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = parseInt(monthMatch[2]) - 1;
        return months[monthIndex] || period;
      }
      return period;
    case 'quarterly':
      return period.replace(/(\d{4})-Q(\d)/, 'Q$2');
    case 'yearly':
      return period;
    default:
      return period;
  }
};

/**
 * Group time periods by year for better display
 */
export const groupTimePeriodsByYear = (timePeriods: DocumentTimePeriod[]): Record<string, DocumentTimePeriod[]> => {
  return timePeriods.reduce((acc, timePeriod) => {
    const frequency = timePeriod.periodType;
    let year: string;
    
    if (frequency === 'monthly' || frequency === 'quarterly') {
      year = timePeriod.period.split('-')[0];
    } else {
      year = timePeriod.period;
    }
    
    if (!acc[year]) {
      acc[year] = [];
    }
    acc[year].push(timePeriod);
    return acc;
  }, {} as Record<string, DocumentTimePeriod[]>);
};

/**
 * Generate unique document ID
 */
export const generateDocumentId = (prefix: string = 'doc'): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Check if a document has been received (has URL)
 */
export const isDocumentReceived = (document: Document): boolean => {
  return Boolean(document.url);
};

/**
 * Get document statistics for a collection of documents
 */
export const getDocumentStats = (documents: Document[]) => {
  const total = documents.length;
  const received = documents.filter(isDocumentReceived).length;
  const pending = total - received;
  
  return {
    total,
    received,
    pending,
    receivedPercentage: total > 0 ? Math.round((received / total) * 100) : 0,
  };
};
