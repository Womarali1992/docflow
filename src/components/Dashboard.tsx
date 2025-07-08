
import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { UserRole } from '@/types/dashboard';
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
  const { toast } = useToast();

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    
    toast({
      title: 'Message Sent',
      description: 'Your message has been delivered successfully.',
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-50">
      <DashboardHeader userRole={userRole} onRoleSwitch={handleRoleSwitch} />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Recent Activity - Horizontal Scroll Top */}
        <RecentActivity activities={mockActivities} />

        {/* Main Content Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Document Upload - Left (Wider) */}
          <div className="lg:col-span-3">
            <DocumentUpload onFileUpload={handleFileUpload} />
          </div>

          {/* Secure Messaging - Right (Thinner) */}
          <div className="lg:col-span-2">
            <SecureMessaging 
              messages={mockMessages}
              userRole={userRole}
              newMessage={newMessage}
              onMessageChange={setNewMessage}
              onSendMessage={handleSendMessage}
            />
          </div>
        </div>

        {/* Document Library - Bottom */}
        <DocumentLibrary 
          documents={mockDocuments}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
      </div>
    </div>
  );
};

export default Dashboard;
