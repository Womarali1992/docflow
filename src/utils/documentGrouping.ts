import { Document } from '@/types/dashboard';

/**
 * Extract the base document name by removing time period suffixes
 * This groups similar documents like "Bank Statements 2024 Jan.pdf" and "Bank Statements 2024 Feb.pdf" 
 * under the same base name "Bank Statements"
 */
export const getBaseDocumentName = (doc: Document): string => {
  let baseName = doc.name;
  
  // Remove common time period patterns based on request frequency
  if (doc.requestFrequency === 'monthly') {
    // Remove patterns like "2024 Jan", "2025 Jun", etc.
    baseName = doc.name.replace(/\s+\d{4}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\w*$/, '');
    // Also remove patterns like "January 2024", "June 2025", etc.
    baseName = baseName.replace(/\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\.?\w*$/, '');
  } else if (doc.requestFrequency === 'quarterly') {
    // Remove patterns like "Q1 2024", "Q2 2025", etc.
    baseName = baseName.replace(/\s+Q[1-4]\s+\d{4}\.?\w*$/, '');
  } else if (doc.requestFrequency === 'yearly') {
    // Remove patterns like "2024", "2025", etc.
    baseName = baseName.replace(/\s+\d{4}\.?\w*$/, '');
  } else {
    // For documents without frequency, remove common year patterns (2024, 2025, etc.)
    baseName = doc.name.replace(/\s+20\d{2}/g, '');
    // Remove common month patterns (Jan, Feb, etc.)
    baseName = baseName.replace(/\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/g, '');
    // Remove common quarter patterns (Q1, Q2, etc.)
    baseName = baseName.replace(/\s+Q[1-4]/g, '');
  }
  
  // Clean up extra spaces
  baseName = baseName.replace(/\s+/g, ' ').trim();
  
  // If no pattern was found, use the original name
  if (baseName === doc.name || baseName === '') {
    baseName = doc.name;
  }
  
  return baseName;
};

/**
 * Group documents by their base document type (excluding time period)
 * This creates groups where similar documents like monthly bank statements
 * are grouped together in the same card
 */
export const groupDocumentsByBaseName = (documents: Document[]): Record<string, Document[]> => {
  return documents.reduce((groups, doc) => {
    const baseName = getBaseDocumentName(doc);
    
    if (!groups[baseName]) {
      groups[baseName] = [];
    }
    groups[baseName].push(doc);
    return groups;
  }, {} as Record<string, Document[]>);
};

/**
 * Group documents by their base document type using a Map for better performance
 */
export const groupDocumentsByBaseNameMap = (documents: Document[]): Map<string, Document[]> => {
  const groups = new Map<string, Document[]>();
  
  documents.forEach(doc => {
    const baseName = getBaseDocumentName(doc);
    
    if (!groups.has(baseName)) {
      groups.set(baseName, []);
    }
    groups.get(baseName)!.push(doc);
  });
  
  return groups;
};

