
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, FileText, User, Send, Upload, Download, Search, Bell, Settings } from 'lucide-react';
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
      description: 'Q3 Portfolio Analysis uploaded',
      timestamp: new Date(2024, 6, 7, 9, 0),
      user: 'John Smith'
    },
    {
      id: '2',
      type: 'message',
      description: 'New message received',
      timestamp: new Date(2024, 6, 7, 11, 15),
      user: 'Sarah Johnson'
    },
    {
      id: '3',
      type: 'update',
      description: 'Portfolio rebalancing recommendations',
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-sky-25 to-indigo-25">
      {/* Header */}
      <header className="bg-white border-b-2 border-blue-300 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-md flex items-center justify-center">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-blue-900">WealthLink Portal</h1>
                <p className="text-sm text-blue-600">Professional Client Management</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 border-2 border-blue-300">
                <Bell className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 border-2 border-blue-300">
                <Settings className="h-4 w-4" />
              </Button>
              <Badge 
                variant={userRole === 'advisor' ? 'default' : 'secondary'}
                className={userRole === 'advisor' ? 'bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-700' : 'bg-blue-100 text-blue-800 border-2 border-blue-400'}
              >
                {userRole === 'advisor' ? 'Financial Advisor' : 'Client'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserRole(userRole === 'advisor' ? 'client' : 'advisor')}
                className="border-2 border-blue-400 text-blue-700 hover:bg-blue-100"
              >
                Switch Role
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Recent Activity - Horizontal Scroll Top */}
        <Card className="border-2 border-blue-300 bg-white shadow-lg">
          <CardHeader className="border-b-2 border-blue-200 bg-gradient-to-r from-blue-100 to-sky-100">
            <CardTitle className="text-blue-800 flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex gap-4 overflow-x-auto pb-2">
              {activities.map((activity) => (
                <div key={activity.id} className="flex-shrink-0 w-48 h-48 p-4 rounded-lg border-2 border-blue-300 bg-gradient-to-br from-blue-100 to-sky-100 hover:shadow-md transition-all">
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                        activity.type === 'message' ? 'bg-blue-200 border-blue-400' :
                        activity.type === 'document' ? 'bg-green-200 border-green-400' : 'bg-purple-200 border-purple-400'
                      }`}>
                        {activity.type === 'message' && <MessageSquare className="h-4 w-4 text-blue-600" />}
                        {activity.type === 'document' && <FileText className="h-4 w-4 text-green-600" />}
                        {activity.type === 'update' && <User className="h-4 w-4 text-purple-600" />}
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col justify-between">
                      <p className="font-medium text-blue-800 text-sm leading-tight mb-3">{activity.description}</p>
                      <div className="space-y-2">
                        <Badge variant="outline" className="border-2 border-blue-400 text-blue-700 bg-blue-50 text-xs">
                          {activity.user}
                        </Badge>
                        <div className="group relative">
                          <Badge 
                            variant="secondary" 
                            className="bg-blue-200 text-blue-800 border-2 border-blue-300 text-xs cursor-pointer"
                          >
                            {activity.timestamp.toLocaleDateString()}
                          </Badge>
                          <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                            {activity.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Main Content Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Document Upload - Left (Wider) */}
          <div className="lg:col-span-3">
            <Card className="border-2 border-blue-300 bg-white shadow-lg">
              <CardHeader className="border-b-2 border-blue-200 bg-gradient-to-r from-blue-100 to-sky-100">
                <CardTitle className="text-blue-800 flex items-center gap-2">
                  <Upload className="h-5 w-5 text-blue-600" />
                  Document Upload
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="border-2 border-dashed border-blue-400 rounded-lg p-8 text-center bg-gradient-to-br from-blue-100 to-sky-100 hover:border-blue-500 transition-colors">
                  <div className="w-12 h-12 bg-blue-300 border-2 border-blue-400 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <Upload className="h-6 w-6 text-blue-700" />
                  </div>
                  <h3 className="text-base font-medium text-blue-800 mb-2">Upload Documents</h3>
                  <p className="text-blue-600 mb-4 text-sm">Drag files here or click to browse</p>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                    />
                    <Button variant="outline" className="border-2 border-blue-400 text-blue-700 hover:bg-blue-100">
                      Choose Files
                    </Button>
                  </label>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Secure Messaging - Right (Thinner) */}
          <div className="lg:col-span-2">
            <Card className="border-2 border-blue-300 bg-white shadow-lg">
              <CardHeader className="border-b-2 border-blue-200 bg-gradient-to-r from-blue-100 to-sky-100">
                <CardTitle className="text-blue-800 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  Secure Messaging
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4 max-h-64 overflow-y-auto mb-6 bg-gradient-to-br from-blue-100 to-sky-100 rounded-lg p-4 border-2 border-blue-200">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-md p-4 rounded-lg border-2 ${
                        message.role === userRole 
                          ? 'bg-blue-600 text-white border-blue-700' 
                          : 'bg-white text-blue-900 border-blue-300'
                      }`}>
                        <div className="font-medium text-sm mb-2">{message.sender}</div>
                        <p className="text-sm leading-relaxed">{message.content}</p>
                        <div className={`text-xs mt-2 ${
                          message.role === userRole ? 'text-blue-100' : 'text-blue-500'
                        }`}>
                          {message.timestamp.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="flex gap-3">
                  <Textarea
                    placeholder="Type your secure message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="flex-1 border-2 border-blue-400 focus:border-blue-600 focus:ring-blue-500"
                    rows={2}
                  />
                  <Button 
                    onClick={handleSendMessage} 
                    className="bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-700"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Document Slider - Bottom */}
        <Card className="border-2 border-blue-300 bg-white shadow-lg">
          <CardHeader className="border-b-2 border-blue-200 bg-gradient-to-r from-blue-100 to-sky-100">
            <CardTitle className="flex items-center justify-between text-blue-800">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Document Library
              </div>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3 text-blue-400" />
                <Input
                  placeholder="Search documents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64 border-2 border-blue-400 focus:border-blue-600"
                />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex gap-4 overflow-x-auto pb-2">
              {filteredDocuments.map((doc) => (
                <div key={doc.id} className="flex-shrink-0 w-56 h-56 p-4 border-2 border-blue-300 rounded-lg bg-gradient-to-br from-blue-100 to-sky-100 hover:bg-blue-200 transition-colors">
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-300 border-2 border-blue-400 rounded-lg flex items-center justify-center">
                        <FileText className="h-5 w-5 text-blue-700" />
                      </div>
                      <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-200 border-2 border-blue-300 ml-auto">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="font-medium text-blue-800 text-sm mb-2 line-clamp-2">{doc.name}</h4>
                        <p className="text-xs text-blue-600 mb-1">{doc.size}</p>
                        <p className="text-xs text-blue-600 mb-3">{doc.uploadedAt.toLocaleDateString()}</p>
                      </div>
                      <div className="space-y-2">
                        <Badge variant="outline" className="border-2 border-blue-400 text-blue-700 bg-blue-50 text-xs w-full justify-center">
                          {doc.folder}
                        </Badge>
                        <Badge variant="secondary" className="bg-blue-200 text-blue-800 border-2 border-blue-300 text-xs w-full justify-center">
                          {doc.uploadedBy}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
