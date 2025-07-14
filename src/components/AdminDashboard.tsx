import React, { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, FileText, Upload, MessageSquare, Users, Clock, Download } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'needs_update' | 'pending';
  lastActivity: Date;
  documentsCount: number;
  messagesCount: number;
}

const mockClients: Client[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    email: 'sarah.j@email.com',
    status: 'active',
    lastActivity: new Date(2024, 6, 7, 11, 15),
    documentsCount: 3,
    messagesCount: 2
  },
  {
    id: '2',
    name: 'Michael Chen',
    email: 'michael.chen@email.com',
    status: 'needs_update',
    lastActivity: new Date(2024, 6, 3, 9, 30),
    documentsCount: 1,
    messagesCount: 5
  },
  {
    id: '3',
    name: 'Emma Rodriguez',
    email: 'emma.r@email.com',
    status: 'pending',
    lastActivity: new Date(2024, 6, 1, 16, 45),
    documentsCount: 0,
    messagesCount: 1
  }
];

const AdminDashboard = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      toast({
        title: 'Document Uploaded',
        description: `${files[0].name} has been uploaded successfully.`,
      });
    }
  };

  const handleSendMessage = (clientName: string) => {
    toast({
      title: 'Message Sent',
      description: `Message sent to ${clientName}`,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'needs_update': return 'bg-orange-100 text-orange-800';
      case 'pending': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredClients = mockClients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockClients.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Need Updates</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {mockClients.filter(c => c.status === 'needs_update').length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documents</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockClients.reduce((sum, c) => sum + c.documentsCount, 0)}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockClients.reduce((sum, c) => sum + c.messagesCount, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="clients" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="clients">Client Management</TabsTrigger>
          <TabsTrigger value="documents">Document Center</TabsTrigger>
          <TabsTrigger value="messages">Message Center</TabsTrigger>
        </TabsList>
        
        <TabsContent value="clients" className="space-y-4">
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Search clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
          
          <div className="grid gap-4">
            {filteredClients.map((client) => (
              <Card key={client.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold">{client.name}</h3>
                        <Badge className={getStatusColor(client.status)}>
                          {client.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <span className="flex items-center space-x-1">
                          <FileText className="h-3 w-3" />
                          <span>{client.documentsCount} docs</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <MessageSquare className="h-3 w-3" />
                          <span>{client.messagesCount} messages</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Clock className="h-3 w-3" />
                          <span>Last active: {client.lastActivity.toLocaleDateString()}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleSendMessage(client.name)}
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Message
                      </Button>
                      <Button variant="outline" size="sm">
                        <FileText className="h-4 w-4 mr-1" />
                        View Docs
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        
        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Document Upload Center</CardTitle>
              <CardDescription>
                Upload documents for client portfolios and reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Upload Documents</h3>
                  <p className="text-sm text-muted-foreground">
                    Drag and drop files here or click to browse
                  </p>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button variant="outline" className="cursor-pointer">
                      Choose Files
                    </Button>
                  </label>
                </div>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium">Recent Uploads</h4>
                {mockClients.map((client) => (
                  <div key={client.id} className="flex items-center justify-between p-3 bg-muted/50 rounded">
                    <div>
                      <p className="font-medium">{client.name} - Portfolio Report</p>
                      <p className="text-sm text-muted-foreground">Uploaded 2 hours ago</p>
                    </div>
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="messages" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Client Messages</CardTitle>
              <CardDescription>
                Recent messages and conversations with clients
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {mockClients.map((client) => (
                <div key={client.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium">{client.name}</h4>
                      {client.messagesCount > 0 && (
                        <Badge variant="secondary">{client.messagesCount} new</Badge>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleSendMessage(client.name)}>
                      Reply
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Last message: {client.lastActivity.toLocaleString()}
                  </p>
                  <p className="text-sm">
                    "Thank you for the portfolio update. Could we schedule a call to discuss the rebalancing options?"
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminDashboard;