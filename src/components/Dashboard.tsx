
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { UserRole, Document } from '@/types/dashboard';
import { mockMessages, mockDocuments, mockActivities } from '@/utils/mockData';
import { useDocumentsStore } from '@/context/DocumentsContext';
import DashboardHeader from './DashboardHeader';
import RecentActivity from './RecentActivity';
import DocumentUpload from './DocumentUpload';
import SecureMessaging from './SecureMessaging';
import DocumentLibrary from './DocumentLibrary';
import AdvisorDashboard from './AdvisorDashboard';

const Dashboard = () => {
  const [userRole, setUserRole] = useState<UserRole>('advisor');
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const { documents, setDocuments } = useDocumentsStore();
  const { toast } = useToast();

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    
    const contextText = selectedDocument 
      ? `Message sent regarding ${selectedDocument.name}`
      : 'Message sent successfully';
    
    toast({
      title: 'Message Sent',
      description: contextText,
    });
    
    setNewMessage('');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const formatFileSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      const mb = kb / 1024;
      return `${mb.toFixed(1)} MB`;
    };

    const uploadedBy = userRole === 'advisor' ? 'John Smith' : 'Sarah Johnson';
    const now = new Date();

    const newDocs: Document[] = Array.from(files).map((file, idx) => {
      const extensionMatch = file.name.split('.');
      const extension = extensionMatch.length > 1 ? extensionMatch.pop()!.toLowerCase() : '';
      
      // Check if this file fulfills a requested document
      const requestedDoc = documents.find(doc => 
        doc.isRequested && 
        !doc.url && 
        (doc.name.toLowerCase().includes(file.name.toLowerCase().split('.')[0]) ||
         file.name.toLowerCase().includes(doc.name.toLowerCase().split('.')[0]))
      );

      if (requestedDoc) {
        // Update the requested document with the uploaded file
        return {
          ...requestedDoc,
          type: extension,
          size: formatFileSize(file.size),
          uploadedBy,
          uploadedAt: now,
          url: URL.createObjectURL(file),
          isRequested: false, // No longer requested since it's fulfilled
        };
      }

      return {
        id: `${now.getTime()}-${idx}`,
        name: file.name,
        type: extension,
        size: formatFileSize(file.size),
        uploadedBy,
        uploadedAt: now,
        folder: 'Uploads',
        url: URL.createObjectURL(file),
      };
    });

    // Update documents, replacing requested ones or adding new ones
    setDocuments((prev) => {
      const updatedDocs = [...prev];
      newDocs.forEach(newDoc => {
        if (newDoc.isRequested === false) {
          // This was a requested document that got fulfilled
          const index = updatedDocs.findIndex(doc => doc.id === newDoc.id);
          if (index !== -1) {
            updatedDocs[index] = newDoc;
          }
        } else {
          // This is a new document
          updatedDocs.unshift(newDoc);
        }
      });
      return updatedDocs;
    });

    setSelectedDocument(newDocs[0]);

    const fulfilledRequestsCount = newDocs.filter(doc => doc.isRequested === false && doc.requestedBy).length;
    
    toast({
      title: newDocs.length > 1 ? 'Files Uploaded' : 'File Uploaded',
      description:
        fulfilledRequestsCount > 0
          ? `${fulfilledRequestsCount} requested document${fulfilledRequestsCount > 1 ? 's' : ''} fulfilled successfully.`
          : newDocs.length > 1
          ? `${newDocs.length} files have been uploaded successfully.`
          : `${newDocs[0].name} has been uploaded successfully.`,
    });
  };

  const handleRoleSwitch = () => {
    setUserRole(userRole === 'advisor' ? 'client' : 'advisor');
  };

  const handleDocumentSelect = (documentName: string) => {
    console.log('Looking for document:', documentName);
    console.log('Available documents:', mockDocuments.map(d => d.name));
    
    // Try exact match first
    let document = mockDocuments.find(doc => doc.name === documentName);
    
    // If no exact match, try partial match
    if (!document) {
      document = mockDocuments.find(doc => 
        doc.name.toLowerCase().includes(documentName.toLowerCase()) ||
        documentName.toLowerCase().includes(doc.name.toLowerCase())
      );
    }
    
    // If still no match, try matching without file extension
    if (!document) {
      const nameWithoutExt = documentName.replace(/\.[^/.]+$/, "");
      document = mockDocuments.find(doc => 
        doc.name.toLowerCase().includes(nameWithoutExt.toLowerCase()) ||
        nameWithoutExt.toLowerCase().includes(doc.name.replace(/\.[^/.]+$/, "").toLowerCase())
      );
    }
    
    console.log('Found document:', document);
    
    if (document) {
      setSelectedDocument(document);
      toast({
        title: 'Document Selected',
        description: `Now viewing ${document.name}`,
      });
    } else {
      toast({
        title: 'Document Not Found',
        description: `Could not find document: ${documentName}`,
        variant: 'destructive'
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedDocument(null);
  };

  // Show different dashboards based on user role
  if (userRole === 'advisor') {
    return (
      <>
        <DashboardHeader userRole={userRole} onRoleSwitch={handleRoleSwitch} />
        <AdvisorDashboard />
      </>
    );
  }

  return (
    <div className="slate-theme min-h-screen bg-gradient-to-br from-slate-50 via-background to-slate-50">
      <DashboardHeader userRole={userRole} onRoleSwitch={handleRoleSwitch} />

      <div className="max-w-7xl mx-auto p-6">
        {/* Main Content Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Recent Activity - Full Width with reduced height */}
          <div className="col-span-12">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl shadow-xl overflow-hidden">
              <RecentActivity 
                activities={mockActivities} 
                onDocumentSelect={handleDocumentSelect}
              />
            </div>
          </div>

          {/* Reports Made For You - Full Width */}
          <div className="col-span-12">
            <Card className="border border-border">
              <CardHeader className="bg-gradient-to-r from-emerald-100 to-emerald-50 border-b">
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <FileText className="h-5 w-5" />
                  Reports Made For You
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {documents.filter(d => d.folder === 'Reports').map(doc => (
                    <Card key={doc.id} className="border border-gray-200">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-gray-900 text-sm truncate">{doc.name}</h4>
                          <Badge variant="outline" className="text-xs">report</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300">
                            Generated {doc.uploadedAt.toLocaleDateString()}
                          </Badge>
                          {doc.requestFrequency && doc.requestFrequency !== 'one-time' && (
                            <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300">
                              {(() => {
                                const next = new Date(doc.uploadedAt);
                                if (doc.requestFrequency === 'monthly') next.setMonth(next.getMonth() + 1);
                                else if (doc.requestFrequency === 'quarterly') next.setMonth(next.getMonth() + 3);
                                else if (doc.requestFrequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
                                return `Due ${next.toLocaleDateString()}`;
                              })()}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Document Upload - 8 columns */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-card rounded-2xl shadow-lg border border-border h-full">
              <DocumentUpload 
                onFileUpload={handleFileUpload}
                selectedDocument={selectedDocument}
                onClearSelection={handleClearSelection}
              />
            </div>
          </div>

          {/* Secure Messaging - 4 columns */}
          <div className="col-span-12 lg:col-span-4">
            <div className="bg-card rounded-2xl shadow-lg border border-border h-full">
              <SecureMessaging 
                messages={mockMessages}
                userRole={userRole}
                newMessage={newMessage}
                onMessageChange={setNewMessage}
                onSendMessage={handleSendMessage}
                selectedDocument={selectedDocument}
              />
            </div>
          </div>

          {/* Document Library - Full Width */}
          <div className="col-span-12">
            <div className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden">
              <DocumentLibrary 
                documents={documents}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onSelectDocument={(doc) => setSelectedDocument(doc)}
                canManageRequests={userRole === 'advisor'}
                showDateFilter={userRole === 'client'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
