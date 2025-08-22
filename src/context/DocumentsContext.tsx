import React, { createContext, useContext, useMemo, useState, ReactNode, useEffect } from 'react';
import { Document, RequestFrequency, DocumentRequest, DocumentPreset, PresetBin } from '@/types/dashboard';
import { mockDocuments } from '@/utils/mockData';

interface DocumentsContextValue {
  documents: Document[];
  setDocuments: React.Dispatch<React.SetStateAction<Document[]>>;
  requestDocument: (params: {
    documentName: string;
    description?: string;
    requestedBy: string;
    clientId: string;
    frequency: RequestFrequency;
  }) => DocumentRequest;
  requestDocumentUpdate: (params: {
    documentId: string;
    requestedBy: string;
    description?: string;
    requestedVersion?: string;
  }) => void;
  updateRequestFrequency: (documentId: string, frequency: RequestFrequency) => void;
  updateDocumentDueDate: (documentId: string, dueDate: Date | undefined) => void;
  deleteRequestedDocument: (documentId: string) => void;
  // Presets API
  presets: DocumentPreset[];
  savePreset: (name: string, bins: PresetBin[]) => DocumentPreset;
  updatePreset: (presetId: string, update: Partial<Pick<DocumentPreset, 'name' | 'bins'>>) => void;
  deletePreset: (presetId: string) => void;
  applyPresetToClient: (presetId: string, params: { clientId: string; advisorName: string; }) => void;
}

const DocumentsContext = createContext<DocumentsContextValue | undefined>(undefined);

export const DocumentsProvider = ({ children }: { children: ReactNode }) => {
  const [documents, setDocuments] = useState<Document[]>(mockDocuments);
  const [presets, setPresets] = useState<DocumentPreset[]>(() => {
    try {
      const raw = localStorage.getItem('wlp.documentPresets');
      if (!raw) return [];
      const parsed: DocumentPreset[] = JSON.parse(raw);
      return parsed.map(p => ({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      }));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('wlp.documentPresets', JSON.stringify(presets));
    } catch {
      // ignore
    }
  }, [presets]);

  const requestDocument: DocumentsContextValue['requestDocument'] = ({ documentName, description, requestedBy, clientId, frequency }) => {
    const now = new Date();
    
    // Check if there's an existing document with similar name that could be an update request
    const existingDoc = documents.find(doc => {
      if (!doc.url) return false; // Skip documents that don't exist yet
      
      const docBaseName = doc.name.toLowerCase().replace(/\.[^/.]+$/, ''); // Remove extension
      const requestedBaseName = documentName.toLowerCase().replace(/\.[^/.]+$/, '');
      
      // Check for similar base names (e.g., "Tax Returns" matches)
      const baseWords = docBaseName.split(' ').filter(word => word.length > 2);
      const requestedWords = requestedBaseName.split(' ').filter(word => word.length > 2);
      
      // If most significant words match, consider it the same document type
      const matchingWords = baseWords.filter(word => requestedWords.includes(word));
      return matchingWords.length >= Math.min(2, Math.max(baseWords.length, requestedWords.length) * 0.6);
    });

    if (existingDoc) {
      // Extract version from requested document name (e.g., "2024" from "Tax Returns 2024")
      const versionMatch = documentName.match(/\b(19|20)\d{2}\b/);
      const requestedVersion = versionMatch ? versionMatch[0] : undefined;
      
      // Add update request to existing document
      requestDocumentUpdate({
        documentId: existingDoc.id,
        requestedBy,
        description,
        requestedVersion
      });
      
      return {
        id: existingDoc.id,
        documentName,
        description,
        requestedBy,
        requestedAt: now,
        clientId,
        status: 'pending',
        frequency,
      };
    }

    // Create new requested document if no existing document found
    const newRequestedDoc: Document = {
      id: `req-${now.getTime()}`,
      name: documentName,
      type: '',
      size: '',
      uploadedBy: '',
      uploadedAt: now,
      folder: 'Documents',
      clientId,
      isRequested: true,
      requestedBy,
      requestedAt: now,
      description,
      requestFrequency: frequency,
    };

    setDocuments(prev => [newRequestedDoc, ...prev]);

    return {
      id: newRequestedDoc.id,
      documentName,
      description,
      requestedBy,
      requestedAt: now,
      clientId,
      status: 'pending',
      frequency,
    };
  };

  const requestDocumentUpdate: DocumentsContextValue['requestDocumentUpdate'] = ({ documentId, requestedBy, description, requestedVersion }) => {
    const now = new Date();
    setDocuments(prev => prev.map(doc => 
      doc.id === documentId 
        ? { 
            ...doc, 
            hasUpdateRequest: true,
            updateRequestedBy: requestedBy,
            updateRequestedAt: now,
            updateRequestDescription: description,
            requestedVersion
          } 
        : doc
    ));
  };

  const updateRequestFrequency: DocumentsContextValue['updateRequestFrequency'] = (documentId, frequency) => {
    setDocuments(prev => prev.map(doc => doc.id === documentId ? { ...doc, requestFrequency: frequency } : doc));
  };

  const updateDocumentDueDate: DocumentsContextValue['updateDocumentDueDate'] = (documentId, dueDate) => {
    setDocuments(prev => prev.map(doc => doc.id === documentId ? { ...doc, dueDate } : doc));
  };

  const deleteRequestedDocument: DocumentsContextValue['deleteRequestedDocument'] = (documentId) => {
    setDocuments(prev => prev.filter(doc => doc.id !== documentId));
  };

  const inferFrequencyFromLabel = (label: string): RequestFrequency => {
    const l = label.toLowerCase();
    if (l.includes('day')) return 'daily';
    if (l.includes('month')) return 'monthly';
    if (l.includes('quarter')) return 'quarterly';
    if (l.includes('year')) return 'yearly';
    if (l.includes('one')) return 'one-time';
    return 'one-time';
  };

  const savePreset: DocumentsContextValue['savePreset'] = (name, bins) => {
    const now = new Date();
    const preset: DocumentPreset = {
      id: `preset-${now.getTime()}`,
      name: name.trim() || `Preset ${presets.length + 1}`,
      bins: bins.map(b => ({ id: b.id, label: b.label, items: b.items.map(i => ({ name: i.name })) })),
      createdAt: now,
      updatedAt: now,
    };
    setPresets(prev => [preset, ...prev]);
    return preset;
  };

  const updatePreset: DocumentsContextValue['updatePreset'] = (presetId, update) => {
    setPresets(prev => prev.map(p => p.id === presetId ? { ...p, ...update, updatedAt: new Date() } : p));
  };

  const deletePreset: DocumentsContextValue['deletePreset'] = (presetId) => {
    setPresets(prev => prev.filter(p => p.id !== presetId));
  };

  const applyPresetToClient: DocumentsContextValue['applyPresetToClient'] = (presetId, { clientId, advisorName }) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    const seen = new Set<string>();
    preset.bins.forEach(bin => {
      const frequency = inferFrequencyFromLabel(bin.label);
      bin.items.forEach(item => {
        const key = item.name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        requestDocument({
          documentName: item.name,
          requestedBy: advisorName,
          clientId,
          frequency,
        });
      });
    });
  };

  const value = useMemo(() => ({
    documents,
    setDocuments,
    requestDocument,
    requestDocumentUpdate,
    updateRequestFrequency,
    updateDocumentDueDate,
    deleteRequestedDocument,
    presets,
    savePreset,
    updatePreset,
    deletePreset,
    applyPresetToClient,
  }), [documents, presets]);

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
};

export const useDocumentsStore = () => {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocumentsStore must be used within DocumentsProvider');
  return ctx;
};


