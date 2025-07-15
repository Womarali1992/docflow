import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, ChevronRight, FileText, Upload, MessageSquare, Calendar, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Client {
  id: string;
  name: string;
  email: string;
  lastActivity: Date;
  documentsCount: number;
  pendingUpdates: number;
  unreadMessages: number;
}

interface ClientDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: Date;
  size: string;
  status: 'pending' | 'reviewed' | 'needs_update';
}

interface Message {
  id: string;
  text: string;
  sender: 'advisor' | 'client';
  timestamp: Date;
  documentId: string;
}

interface Report {
  id: string;
  title: string;
  type: 'portfolio_analysis' | 'performance_report' | 'recommendation';
  generatedAt: Date;
  clientId: string;
}

const mockClients: Client[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah.johnson@email.com',
    lastActivity: new Date(2024, 6, 7, 11, 15),
    documentsCount: 8,
    pendingUpdates: 2,
    unreadMessages: 3
  },
  {
    id: '2',
    name: 'Michael Chen',
    email: 'michael.chen@email.com',
    lastActivity: new Date(2024, 6, 6, 14, 30),
    documentsCount: 12,
    pendingUpdates: 0,
    unreadMessages: 1
  },
  {
    id: '3',
    name: 'Emily Davis',
    email: 'emily.davis@email.com',
    lastActivity: new Date(2024, 6, 5, 9, 45),
    documentsCount: 6,
    pendingUpdates: 1,
    unreadMessages: 0
  }
];

const mockClientDocuments: ClientDocument[] = [
  {
    id: '1',
    name: 'Bank Statement June.pdf',
    type: 'pdf',
    uploadedAt: new Date(2024, 6, 5, 14, 30),
    size: '890 KB',
    status: 'pending'
  },
  {
    id: '2',
    name: 'Tax Return 2023.pdf',
    type: 'pdf',
    uploadedAt: new Date(2024, 6, 3, 10, 15),
    size: '1.2 MB',
    status: 'reviewed'
  },
  {
    id: '3',
    name: 'Investment Goals.docx',
    type: 'docx',
    uploadedAt: new Date(2024, 6, 2, 16, 20),
    size: '245 KB',
    status: 'needs_update'
  }
];

const mockMessages: Message[] = [
  {
    id: '1',
    text: 'Could you please review this bank statement? I noticed some unusual transactions.',
    sender: 'advisor',
    timestamp: new Date(2024, 6, 5, 15, 0),
    documentId: '1'
  },
  {
    id: '2',
    text: 'I can explain those transactions. They were for my new business setup.',
    sender: 'client',
    timestamp: new Date(2024, 6, 5, 16, 30),
    documentId: '1'
  },
  {
    id: '3',
    text: 'Thank you for the clarification. Could you provide documentation for the business expenses?',
    sender: 'advisor',
    timestamp: new Date(2024, 6, 6, 9, 15),
    documentId: '1'
  },
  {
    id: '4',
    text: 'The tax return looks good overall, but we need to discuss the capital gains section.',
    sender: 'advisor',
    timestamp: new Date(2024, 6, 3, 11, 0),
    documentId: '2'
  },
  {
    id: '5',
    text: 'Please update your investment goals to reflect our recent discussion about risk tolerance.',
    sender: 'advisor',
    timestamp: new Date(2024, 6, 2, 17, 0),
    documentId: '3'
  }
];

const mockReports: Report[] = [
  {
    id: '1',
    title: 'Q3 Portfolio Analysis',
    type: 'portfolio_analysis',
    generatedAt: new Date(2024, 6, 7, 9, 0),
    clientId: '1'
  },
  {
    id: '2',
    title: 'Performance Review June 2024',
    type: 'performance_report',
    generatedAt: new Date(2024, 6, 6, 15, 30),
    clientId: '1'
  },
  {
    id: '3',
    title: 'Investment Recommendations Update',
    type: 'recommendation',
    generatedAt: new Date(2024, 6, 5, 11, 45),
    clientId: '1'
  }
];

const AdvisorDashboard = () => {
  const [currentClientIndex, setCurrentClientIndex] = useState(0);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const { toast } = useToast();
  
  const currentClient = mockClients[currentClientIndex];

  const nextClient = () => {
    setCurrentClientIndex((prev) => (prev + 1) % mockClients.length);
  };

  const prevClient = () => {
    setCurrentClientIndex((prev) => (prev - 1 + mockClients.length) % mockClients.length);
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'reviewed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'needs_update':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleDocumentAction = (documentId: string, action: string) => {
    toast({
      title: 'Document Action',
      description: `Document ${action} successfully`,
    });
  };

  const handleSendMessage = () => {
    if (newMessage.trim() && selectedDocumentId) {
      const newMsg: Message = {
        id: Date.now().toString(),
        text: newMessage.trim(),
        sender: 'advisor',
        timestamp: new Date(),
        documentId: selectedDocumentId
      };
      setMessages(prev => [...prev, newMsg]);
      setNewMessage('');
      toast({
        title: "Message Sent",
        description: "Your message has been sent to the client",
      });
    }
  };

  const selectedDocument = mockClientDocuments.find(doc => doc.id === selectedDocumentId);
  const documentMessages = messages.filter(msg => msg.documentId === selectedDocumentId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Client Navigation Header */}
        <Card className="mb-6 border-blue-200 shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="sm" onClick={prevClient}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <div className="text-center">
                  <CardTitle className="text-xl font-semibold text-blue-900">
                    {currentClient.name}
                  </CardTitle>
                  <p className="text-sm text-blue-600">{currentClient.email}</p>
                  <p className="text-xs text-gray-500">
                    Last activity: {currentClient.lastActivity.toLocaleDateString()}
                  </p>
                </div>
                
                <Button variant="outline" size="sm" onClick={nextClient}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex items-center gap-4">
                <div 
                  className="relative flex items-center justify-center w-48 h-16 border-2 border-dashed border-blue-300 rounded-lg bg-blue-50/50 hover:bg-blue-100/50 transition-colors cursor-pointer group"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    toast({
                      title: "File Drop",
                      description: "File upload functionality would be implemented here",
                    });
                  }}
                  onClick={() => {
                    toast({
                      title: "Upload Click",
                      description: "File browser would open here",
                    });
                  }}
                >
                  <div className="text-center">
                    <Upload className="h-5 w-5 text-blue-600 mx-auto mb-1 group-hover:text-blue-700" />
                    <span className="text-xs text-blue-700 font-medium">Drop files or click</span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-900">{currentClient.documentsCount}</div>
                  <div className="text-xs text-gray-600">Documents</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{currentClient.pendingUpdates}</div>
                  <div className="text-xs text-gray-600">Pending</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{currentClient.unreadMessages}</div>
                  <div className="text-xs text-gray-600">Messages</div>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Client Document Uploads - Top Section */}
        <Card className="mb-6 border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-100 to-blue-50 border-b border-blue-200">
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <Upload className="h-5 w-5" />
              Client Document Uploads
              {selectedDocumentId && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSelectedDocumentId(null)}
                  className="ml-auto"
                >
                  Close Messages
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className={`grid gap-6 ${selectedDocumentId ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* Documents List */}
              <div className="space-y-4">
                {mockClientDocuments.map((doc) => (
                  <div key={doc.id} className={`p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
                    selectedDocumentId === doc.id ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
                  }`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
                        <div className="min-w-0">
                          <h4 className="font-medium text-gray-900 truncate">{doc.name}</h4>
                          <p className="text-sm text-gray-500">
                            {doc.size} • Uploaded {doc.uploadedAt.toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className={getStatusBadgeColor(doc.status)}>
                          {doc.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button 
                        size="sm" 
                        variant={selectedDocumentId === doc.id ? "default" : "outline"}
                        onClick={() => setSelectedDocumentId(selectedDocumentId === doc.id ? null : doc.id)}
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Messages
                      </Button>
                      
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleDocumentAction(doc.id, 'reviewed')}
                      >
                        Review
                      </Button>
                      {doc.status === 'needs_update' && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleDocumentAction(doc.id, 'requested update')}
                        >
                          Request Update
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Messages Panel */}
              {selectedDocumentId && (
                <div className="border-l border-gray-200 pl-6 flex flex-col h-96">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-5 w-5 text-blue-600" />
                    <h3 className="font-medium text-gray-900">
                      Messages: {selectedDocument?.name}
                    </h3>
                  </div>
                  
                  {/* Message History - Takes up most space */}
                  <div className="flex-1 space-y-3 overflow-y-auto mb-4 pr-2">
                    {documentMessages.length > 0 ? (
                      documentMessages.map((message) => (
                        <div 
                          key={message.id} 
                          className={`p-3 rounded-lg ${
                            message.sender === 'advisor' 
                              ? 'bg-blue-100 ml-4' 
                              : 'bg-gray-100 mr-4'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-600">
                              {message.sender === 'advisor' ? 'You' : 'Client'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {message.timestamp.toLocaleDateString()} {message.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>
                          <p className="text-sm text-gray-800">{message.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500 text-center py-8">
                        No messages yet for this document.
                      </p>
                    )}
                  </div>
                  
                  {/* New Message Input - Fixed at bottom */}
                  <div className="border-t pt-4 space-y-3">
                    <Textarea 
                      placeholder="Type your message about this document..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      className="min-h-[80px] resize-none"
                    />
                    <Button 
                      size="sm" 
                      className="w-full"
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim()}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Send Message
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Generated Reports - Bottom Section */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-green-100 to-green-50 border-b border-green-200">
            <CardTitle className="flex items-center gap-2 text-green-900">
              <FileText className="h-5 w-5" />
              Reports Generated for You
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {mockReports.map((report) => (
                <Card key={report.id} className="border border-gray-200 hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium text-gray-900 text-sm">{report.title}</h4>
                      <Badge variant="outline" className="text-xs">
                        {report.type.replace('_', ' ')}
                      </Badge>
                    </div>
                    
                    <p className="text-xs text-gray-500 mb-3">
                      Generated {report.generatedAt.toLocaleDateString()}
                    </p>
                    
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="text-xs">
                        View
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs">
                        Download
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs">
                        Share
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdvisorDashboard;