
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <DashboardHeader userRole={userRole} onRoleSwitch={handleRoleSwitch} />

      <div className="max-w-7xl mx-auto p-6">
        {/* Hero Section */}
        <div className="mb-8">
          <div className="text-center py-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl text-white shadow-xl">
            <h2 className="text-3xl font-bold mb-3">Welcome to WealthLink Portal</h2>
            <p className="text-blue-100 text-lg max-w-2xl mx-auto">
              Your comprehensive platform for secure financial collaboration and document management
            </p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Recent Activity - Full Width */}
          <div className="col-span-12">
            <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden">
              <RecentActivity activities={mockActivities} />
            </div>
          </div>

          {/* Document Upload - 8 columns */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-lg border border-blue-100 h-full">
              <DocumentUpload onFileUpload={handleFileUpload} />
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
