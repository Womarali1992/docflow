
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

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Unified Container Shell */}
        <div className="bg-white border-2 border-blue-300 rounded-lg shadow-lg overflow-hidden">
          {/* Recent Activity - Top Section */}
          <div className="border-b border-gray-200">
            <RecentActivity activities={mockActivities} />
          </div>

          {/* Middle Row - Document Upload and Secure Messaging */}
          <div className="grid grid-cols-1 lg:grid-cols-3 border-b border-gray-200">
            {/* Document Upload - Left (Wider) */}
            <div className="lg:col-span-2 border-r border-gray-200 lg:border-r lg:border-gray-200">
              <DocumentUpload onFileUpload={handleFileUpload} />
            </div>

            {/* Secure Messaging - Right (Thinner) */}
            <div className="lg:col-span-1">
              <SecureMessaging 
                messages={mockMessages}
                userRole={userRole}
                newMessage={newMessage}
                onMessageChange={setNewMessage}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>

          {/* Document Library - Bottom Section */}
          <div>
            <DocumentLibrary 
              documents={mockDocuments}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
