import React, { createContext, useContext, useMemo, useState, ReactNode, useEffect } from 'react';
import { Document, RequestFrequency, DocumentRequest, DocumentPreset, PresetBin, DocumentTimePeriod } from '@/types/dashboard';
import { mockDocuments } from '@/utils/mockData';
import { isSameDocumentType, extractVersionFromName, inferFrequencyFromLabel, generateDocumentId } from '@/utils/documentUtils';
import { STORAGE_KEYS, DOCUMENT_FOLDERS } from '@/constants/app';

interface RequestDocumentParams {
  documentName: string;
  description?: string;
  requestedBy: string;
  clientId: string;
  frequency: RequestFrequency;
}

interface RequestDocumentUpdateParams {
  documentId: string;
  requestedBy: string;
  description?: string;
  requestedVersion?: string;
}

interface ApplyPresetParams {
  clientId: string;
  advisorName: string;
}

interface DocumentsContextValue {
  documents: Document[];
  setDocuments: React.Dispatch<React.SetStateAction<Document[]>>;
  requestDocument: (params: RequestDocumentParams) => DocumentRequest;
  requestDocumentUpdate: (params: RequestDocumentUpdateParams) => void;
  updateRequestFrequency: (documentId: string, frequency: RequestFrequency) => void;
  updateDocumentDueDate: (documentId: string, dueDate: Date | undefined) => void;
  deleteRequestedDocument: (documentId: string) => void;
  updateDocumentTimePeriods: (documentId: string, timePeriods: DocumentTimePeriod[]) => void;
  // Presets API
  presets: DocumentPreset[];
  savePreset: (name: string, bins: PresetBin[]) => DocumentPreset;
  updatePreset: (presetId: string, update: Partial<Pick<DocumentPreset, 'name' | 'bins'>>) => void;
  deletePreset: (presetId: string) => void;
  applyPresetToClient: (presetId: string, params: ApplyPresetParams) => void;
}

const DocumentsContext = createContext<DocumentsContextValue | undefined>(undefined);

export const DocumentsProvider = ({ children }: { children: ReactNode }) => {
  const [documents, setDocuments] = useState<Document[]>(mockDocuments);
  const [presets, setPresets] = useState<DocumentPreset[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DOCUMENT_PRESETS);
      if (!raw) return [];
      const parsed: DocumentPreset[] = JSON.parse(raw);
      return parsed.map(preset => ({
        ...preset,
        createdAt: new Date(preset.createdAt),
        updatedAt: new Date(preset.updatedAt),
      }));
    } catch (error) {
      console.warn('Failed to load presets from localStorage:', error);
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DOCUMENT_PRESETS, JSON.stringify(presets));
    } catch (error) {
      console.warn('Failed to save presets to localStorage:', error);
    }
  }, [presets]);

  const requestDocument: DocumentsContextValue['requestDocument'] = ({ documentName, description, requestedBy, clientId, frequency }) => {
    const now = new Date();
    
    // Check if there's an existing document with similar name that could be an update request
    const existingDoc = documents.find(doc => {
      if (!doc.url) return false; // Skip documents that don't exist yet
      return isSameDocumentType(doc.name, documentName);
    });

    if (existingDoc) {
      const requestedVersion = extractVersionFromName(documentName);
      
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
        status: 'pending' as const,
        frequency,
      };
    }

    // Create new requested document if no existing document found
    const newRequestedDoc: Document = {
      id: generateDocumentId('req'),
      name: documentName,
      type: '',
      size: '',
      uploadedBy: '',
      uploadedAt: now,
      folder: DOCUMENT_FOLDERS.DOCUMENTS,
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
        status: 'pending' as const,
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

  const updateDocumentTimePeriods: DocumentsContextValue['updateDocumentTimePeriods'] = (documentId, timePeriods) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === documentId 
        ? { ...doc, selectedTimePeriods: timePeriods }
        : doc
    ));
  };



  const savePreset: DocumentsContextValue['savePreset'] = (name, bins) => {
    const now = new Date();
    const preset: DocumentPreset = {
      id: generateDocumentId('preset'),
      name: name.trim() || `Preset ${presets.length + 1}`,
      bins: bins.map(bin => ({ 
        id: bin.id, 
        label: bin.label, 
        items: bin.items.map(item => ({ name: item.name })) 
      })),
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
    updateDocumentTimePeriods,
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


