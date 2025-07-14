
import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { UserRole, Document } from '@/types/dashboard';
import { mockMessages, mockDocuments, mockActivities } from '@/utils/mockData';
import DashboardHeader from './DashboardHeader';
import RecentActivity from './RecentActivity';
import DocumentUpload from './DocumentUpload';
import SecureMessaging from './SecureMessaging';
import DocumentLibrary from './DocumentLibrary';

const Dashboard = () => {
  const [userRole, setUserRole] = useState<UserRole>('advisor');
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
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
    if (files && files.length > 0) {
      toast({
        title: 'File Uploaded',
        description: `${files[0].name} has been uploaded successfully.`,
      });
    }
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <DashboardHeader userRole={userRole} onRoleSwitch={handleRoleSwitch} />

      <div className="max-w-7xl mx-auto p-6">
        {/* Main Content Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Recent Activity - Full Width with reduced height */}
          <div className="col-span-12">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl overflow-hidden">
              <RecentActivity 
                activities={mockActivities} 
                onDocumentSelect={handleDocumentSelect}
              />
            </div>
          </div>

          {/* Document Upload - 8 columns */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-lg border border-blue-100 h-full">
              <DocumentUpload 
                onFileUpload={handleFileUpload}
                selectedDocument={selectedDocument}
                onClearSelection={handleClearSelection}
              />
            </div>
          </div>

          {/* Secure Messaging - 4 columns */}
          <div className="col-span-12 lg:col-span-4">
            <div className="bg-white rounded-2xl shadow-lg border border-blue-100 h-full">
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
            <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden">
              <DocumentLibrary 
                documents={mockDocuments}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
