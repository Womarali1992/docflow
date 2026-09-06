import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from 'react';
import { api } from '@/api/client';
import type { Document, RequestFrequency } from '@/api/types';
import { useAuth } from './AuthContext';

type DocumentPatch = Partial<{
  name: string;
  folder: string;
  isRequested: boolean;
  status: 'pending' | 'reviewed' | 'needs_update' | 'in_review';
  hasUpdateRequest: boolean;
  updateRequestDescription: string;
  requestedVersion: string;
  requestFrequency: RequestFrequency;
  dueDate: string | null;
}>;

interface DocumentsContextValue {
  documents: Document[];
  loading: boolean;
  refresh: () => Promise<void>;

  // Mutations
  requestDocument: (params: {
    documentName: string;
    description?: string;
    clientId: string;
    frequency: RequestFrequency;
    dueDate?: Date | null;
  }) => Promise<Document>;
  /** Fulfil a request (or upload a new version) by attaching a real file. */
  fulfillRequest: (documentId: string, file: File) => Promise<Document>;
  /** Create a document record from a File and upload its bytes in one step. */
  uploadDocument: (params: { clientId: string; file: File; folder?: string }) => Promise<Document>;
  /** Patch document metadata / status. */
  patchDocument: (id: string, patch: DocumentPatch) => Promise<Document>;
  updateRequestFrequency: (documentId: string, frequency: RequestFrequency) => Promise<void>;
  updateDocumentDueDate: (documentId: string, dueDate: Date | undefined) => Promise<void>;
  deleteRequestedDocument: (documentId: string) => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | undefined>(undefined);

const extOf = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || '';

export const DocumentsProvider = ({ children }: { children: ReactNode }) => {
  const { me } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      setDocuments(await api.documents.list());
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upsert = useCallback((doc: Document) => {
    setDocuments((prev) => {
      const idx = prev.findIndex((d) => d.id === doc.id);
      if (idx === -1) return [doc, ...prev];
      const copy = [...prev];
      copy[idx] = doc;
      return copy;
    });
  }, []);

  const requestDocument = useCallback<DocumentsContextValue['requestDocument']>(
    async ({ documentName, description, clientId, frequency, dueDate }) => {
      const doc = await api.documents.create({
        clientId,
        name: documentName,
        description,
        isRequested: true,
        requestFrequency: frequency,
        dueDate: dueDate ? dueDate.toISOString() : undefined,
      });
      setDocuments((prev) => [doc, ...prev]);
      return doc;
    },
    []
  );

  const fulfillRequest = useCallback<DocumentsContextValue['fulfillRequest']>(
    async (documentId, file) => {
      const updated = await api.documents.uploadFile(documentId, file);
      upsert(updated);
      return updated;
    },
    [upsert]
  );

  const uploadDocument = useCallback<DocumentsContextValue['uploadDocument']>(
    async ({ clientId, file, folder }) => {
      const created = await api.documents.create({
        clientId,
        name: file.name,
        type: extOf(file.name),
        folder: folder || 'Uploads',
      });
      const withFile = await api.documents.uploadFile(created.id, file);
      upsert(withFile);
      return withFile;
    },
    [upsert]
  );

  const patchDocument = useCallback<DocumentsContextValue['patchDocument']>(
    async (id, patch) => {
      const updated = await api.documents.update(id, patch);
      upsert(updated);
      return updated;
    },
    [upsert]
  );

  const updateRequestFrequency = useCallback<DocumentsContextValue['updateRequestFrequency']>(
    async (id, frequency) => {
      const updated = await api.documents.update(id, { requestFrequency: frequency });
      upsert(updated);
    },
    [upsert]
  );

  const updateDocumentDueDate = useCallback<DocumentsContextValue['updateDocumentDueDate']>(
    async (id, dueDate) => {
      const updated = await api.documents.update(id, { dueDate: dueDate ? dueDate.toISOString() : null });
      upsert(updated);
    },
    [upsert]
  );

  const deleteRequestedDocument = useCallback<DocumentsContextValue['deleteRequestedDocument']>(
    async (id) => {
      await api.documents.remove(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    },
    []
  );

  const value = useMemo(
    () => ({
      documents,
      loading,
      refresh,
      requestDocument,
      fulfillRequest,
      uploadDocument,
      patchDocument,
      updateRequestFrequency,
      updateDocumentDueDate,
      deleteRequestedDocument,
    }),
    [
      documents, loading, refresh,
      requestDocument, fulfillRequest, uploadDocument, patchDocument,
      updateRequestFrequency, updateDocumentDueDate, deleteRequestedDocument,
    ]
  );

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
};

export const useDocumentsStore = () => {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocumentsStore must be used within DocumentsProvider');
  return ctx;
};
