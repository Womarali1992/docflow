
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, FileText, User, Send, Upload, Download, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  sender: string;
  role: 'advisor' | 'client';
  content: string;
  timestamp: Date;
}

interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: Date;
  folder: string;
}

interface Activity {
  id: string;
  type: 'message' | 'document' | 'update';
  description: string;
  timestamp: Date;
  user: string;
}

const Dashboard = () => {
  const [userRole, setUserRole] = useState<'advisor' | 'client'>('advisor');
  const [activeTab, setActiveTab] = useState('communications');
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const messages: Message[] = [
    {
      id: '1',
      sender: 'John Smith',
      role: 'advisor',
      content: 'Hi Sarah, I\'ve reviewed your portfolio performance for Q3. Overall looking strong with 8.2% growth. I\'d like to discuss some rebalancing opportunities.',
      timestamp: new Date(2024, 6, 7, 10, 30)
    },
    {
      id: '2',
      sender: 'Sarah Johnson',
      role: 'client',
      content: 'That\'s great news! I\'m available tomorrow afternoon to discuss. Should I prepare any specific documents?',
      timestamp: new Date(2024, 6, 7, 11, 15)
    },
    {
      id: '3',
      sender: 'John Smith',
      role: 'advisor',
      content: 'Perfect! Just bring your latest bank statements. I\'ll send over the portfolio analysis shortly.',
      timestamp: new Date(2024, 6, 7, 11, 45)
    }
  ];

  const documents: Document[] = [
    {
      id: '1',
      name: 'Q3_Portfolio_Analysis.pdf',
      type: 'pdf',
      size: '2.4 MB',
      uploadedBy: 'John Smith',
      uploadedAt: new Date(2024, 6, 7, 9, 0),
      folder: 'Reports'
    },
    {
      id: '2',
      name: 'Bank_Statement_June.pdf',
      type: 'pdf',
      size: '890 KB',
      uploadedBy: 'Sarah Johnson',
      uploadedAt: new Date(2024, 6, 5, 14, 30),
      folder: 'Statements'
    },
    {
      id: '3',
      name: 'Investment_Contract_Amendment.docx',
      type: 'docx',
      size: '156 KB',
      uploadedBy: 'John Smith',
      uploadedAt: new Date(2024, 6, 3, 16, 20),
      folder: 'Contracts'
    }
  ];

  const activities: Activity[] = [
    {
      id: '1',
      type: 'document',
      description: 'Q3 Portfolio Analysis uploaded by John Smith',
      timestamp: new Date(2024, 6, 7, 9, 0),
      user: 'John Smith'
    },
    {
      id: '2',
      type: 'message',
      description: 'New message from Sarah Johnson',
      timestamp: new Date(2024, 6, 7, 11, 15),
      user: 'Sarah Johnson'
    },
    {
      id: '3',
      type: 'update',
      description: 'Portfolio rebalancing recommendations available',
      timestamp: new Date(2024, 6, 6, 15, 45),
      user: 'System'
    }
  ];

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

  const filteredDocuments = documents.filter(doc =>
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.folder.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">WealthLink Portal</h1>
            <p className="text-gray-600 mt-1">Streamlined client relationship management</p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant={userRole === 'advisor' ? 'default' : 'secondary'}>
              {userRole === 'advisor' ? 'Advisor' : 'Client'} View
            </Badge>
            <Button
              variant="outline"
              onClick={() => setUserRole(userRole === 'advisor' ? 'client' : 'advisor')}
            >
              Switch to {userRole === 'advisor' ? 'Client' : 'Advisor'}
            </Button>
          </div>
        </div>

        {/* Main Dashboard */}
        <Tabs defaultValue="communications" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-white border shadow-sm">
            <TabsTrigger value="communications" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Communications
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="updates" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Client Updates
            </TabsTrigger>
          </TabsList>

          {/* Communications Tab */}
          <TabsContent value="communications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Messages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-96 overflow-y-auto mb-4">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-md p-3 rounded-lg ${
                        message.role === userRole 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        <div className="font-medium text-sm mb-1">{message.sender}</div>
                        <p className="text-sm">{message.content}</p>
                        <div className={`text-xs mt-2 ${
                          message.role === userRole ? 'text-blue-100' : 'text-gray-500'
                        }`}>
                          {message.timestamp.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Message Input */}
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="flex-1"
                    rows={2}
                  />
                  <Button onClick={handleSendMessage} className="bg-blue-500 hover:bg-blue-600">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Document Management</span>
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                      <Input
                        placeholder="Search documents..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-64"
                      />
                    </div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Upload Area */}
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-6 hover:border-blue-400 transition-colors">
                  <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">Drag and drop files here, or</p>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                    />
                    <Button variant="outline" className="mt-2">Browse Files</Button>
                  </label>
                </div>

                {/* Documents List */}
                <div className="space-y-3">
                  {filteredDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <FileText className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <h4 className="font-medium">{doc.name}</h4>
                          <p className="text-sm text-gray-500">
                            {doc.folder} • {doc.size} • Uploaded by {doc.uploadedBy}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{doc.folder}</Badge>
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Client Updates Tab */}
          <TabsContent value="updates" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {activities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        activity.type === 'message' ? 'bg-blue-100' :
                        activity.type === 'document' ? 'bg-green-100' : 'bg-purple-100'
                      }`}>
                        {activity.type === 'message' && <MessageSquare className="h-4 w-4 text-blue-500" />}
                        {activity.type === 'document' && <FileText className="h-4 w-4 text-green-500" />}
                        {activity.type === 'update' && <User className="h-4 w-4 text-purple-500" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">{activity.description}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {activity.timestamp.toLocaleString()} • {activity.user}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
