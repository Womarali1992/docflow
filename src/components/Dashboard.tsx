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
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-sky-100">
      {/* Header */}
      <header className="bg-white border-b border-sky-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg flex items-center justify-center">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">WealthLink Portal</h1>
                <p className="text-sm text-slate-600">Professional Client Management</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="text-slate-600 hover:text-sky-600">
                <Bell className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-slate-600 hover:text-sky-600">
                <Settings className="h-4 w-4" />
              </Button>
              <Badge 
                variant={userRole === 'advisor' ? 'default' : 'secondary'}
                className={userRole === 'advisor' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-slate-100 text-slate-700'}
              >
                {userRole === 'advisor' ? 'Financial Advisor' : 'Client'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserRole(userRole === 'advisor' ? 'client' : 'advisor')}
                className="border-sky-200 text-sky-700 hover:bg-sky-50"
              >
                Switch Role
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - All Widgets on One Page */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Communications Widget */}
          <div className="lg:col-span-2">
            <Card className="border-sky-100 shadow-lg h-full">
              <CardHeader className="bg-gradient-to-r from-sky-50 to-white border-b border-sky-100">
                <CardTitle className="text-slate-800 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-sky-600" />
                  Secure Messaging
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4 max-h-80 overflow-y-auto mb-6 bg-slate-50 rounded-lg p-4">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-md p-4 rounded-lg shadow-sm ${
                        message.role === userRole 
                          ? 'bg-gradient-to-r from-sky-500 to-sky-600 text-white' 
                          : 'bg-white text-slate-900 border border-sky-100'
                      }`}>
                        <div className="font-medium text-sm mb-2">{message.sender}</div>
                        <p className="text-sm leading-relaxed">{message.content}</p>
                        <div className={`text-xs mt-2 ${
                          message.role === userRole ? 'text-sky-100' : 'text-slate-500'
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
                    className="flex-1 border-sky-200 focus:border-sky-400 focus:ring-sky-400"
                    rows={3}
                  />
                  <Button 
                    onClick={handleSendMessage} 
                    className="bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 shadow-lg"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Activity Feed Widget */}
          <div>
            <Card className="border-sky-100 shadow-lg h-full">
              <CardHeader className="bg-gradient-to-r from-sky-50 to-white border-b border-sky-100">
                <CardTitle className="text-slate-800 flex items-center gap-2">
                  <User className="h-5 w-5 text-sky-600" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {activities.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-sky-25 transition-colors border border-sky-50 bg-white shadow-sm">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        activity.type === 'message' ? 'bg-sky-100' :
                        activity.type === 'document' ? 'bg-emerald-100' : 'bg-violet-100'
                      }`}>
                        {activity.type === 'message' && <MessageSquare className="h-4 w-4 text-sky-600" />}
                        {activity.type === 'document' && <FileText className="h-4 w-4 text-emerald-600" />}
                        {activity.type === 'update' && <User className="h-4 w-4 text-violet-600" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-800 text-sm">{activity.description}</p>
                        <p className="text-xs text-slate-600 mt-1">
                          {activity.timestamp.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Document Management Widget */}
        <div className="mt-8">
          <Card className="border-sky-100 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-sky-50 to-white border-b border-sky-100">
              <CardTitle className="flex items-center justify-between text-slate-800">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-sky-600" />
                  Document Management Center
                </div>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                  <Input
                    placeholder="Search documents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64 border-sky-200 focus:border-sky-400"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Upload Area */}
                <div className="border-2 border-dashed border-sky-300 rounded-lg p-6 text-center bg-gradient-to-br from-sky-25 to-white hover:border-sky-400 transition-all duration-200">
                  <div className="w-12 h-12 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Upload className="h-6 w-6 text-sky-600" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-800 mb-2">Secure Document Upload</h3>
                  <p className="text-slate-600 mb-3 text-sm">Drag and drop your files here, or click to browse</p>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                    />
                    <Button variant="outline" className="border-sky-300 text-sky-700 hover:bg-sky-50">
                      Choose Files
                    </Button>
                  </label>
                </div>

                {/* Documents List */}
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {filteredDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border border-sky-100 rounded-lg hover:bg-sky-25 transition-colors bg-white shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-sky-100 to-sky-200 rounded-lg flex items-center justify-center">
                          <FileText className="h-5 w-5 text-sky-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-800 text-sm">{doc.name}</h4>
                          <p className="text-xs text-slate-600">
                            {doc.folder} • {doc.size} • {doc.uploadedBy}
                          </p>
                          <p className="text-xs text-slate-500">
                            {doc.uploadedAt.toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-sky-200 text-sky-700 bg-sky-50 text-xs">
                          {doc.folder}
                        </Badge>
                        <Button variant="ghost" size="sm" className="text-sky-600 hover:text-sky-700 hover:bg-sky-50">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
