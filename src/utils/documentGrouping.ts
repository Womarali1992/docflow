import type { RequestFrequency } from '@/api/types';

/**
 * Minimal structural shape needed for grouping — any object with a name and an
 * optional request frequency works (both the API Document and lighter shapes),
 * so callers don't need `as any` casts.
 */
export interface GroupableDoc {
  name: string;
  requestFrequency?: RequestFrequency | null;
}

/**
 * Extract the base document name by removing time-period suffixes so that, e.g.,
 * "Bank Statement Jun 2024" and "Bank Statement Jun 2025" group under "Bank Statement".
 */
export const getBaseDocumentName = (doc: GroupableDoc): string => {
  let baseName = doc.name;

  if (doc.requestFrequency === 'monthly') {
    baseName = doc.name.replace(/\s+\d{4}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\w*$/, '');
    baseName = baseName.replace(/\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\.?\w*$/, '');
  } else if (doc.requestFrequency === 'quarterly') {
    baseName = baseName.replace(/\s+Q[1-4]\s+\d{4}\.?\w*$/, '');
  } else if (doc.requestFrequency === 'yearly') {
    baseName = baseName.replace(/\s+\d{4}\.?\w*$/, '');
  } else {
    baseName = doc.name.replace(/\s+20\d{2}/g, '');
    baseName = baseName.replace(/\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/g, '');
    baseName = baseName.replace(/\s+Q[1-4]/g, '');
  }

  baseName = baseName.replace(/\s+/g, ' ').trim();

  if (baseName === doc.name || baseName === '') {
    baseName = doc.name;
  }

  return baseName;
};

/**
 * Group documents by their base document type (e.g. monthly statements collapse
 * into a single card keyed by the shared base name). Order-preserving.
 */
export function groupDocumentsByBaseNameMap<T extends GroupableDoc>(documents: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  documents.forEach((doc) => {
    const baseName = getBaseDocumentName(doc);
    if (!groups.has(baseName)) groups.set(baseName, []);
    groups.get(baseName)!.push(doc);
  });
  return groups;
}
