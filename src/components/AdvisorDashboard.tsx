import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, ChevronRight, FileText, Upload, MessageSquare, Send, Plus, Trash2, ChevronDown, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import RequestDocumentPopup from './RequestDocumentPopup';
import PreparedMaterials from './PreparedMaterials';
import DocumentsNeeded from './DocumentsNeeded';
import { DocumentRequest, RequestFrequency, Client } from '@/types/dashboard';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { Button as UIButton } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { groupDocumentsByBaseNameMap } from '@/utils/documentGrouping';

// Client interface moved to shared types

interface ClientDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: Date;
  size: string;
  status: 'pending' | 'reviewed' | 'needs_update';
  hasUpdateRequest?: boolean;
  updateRequestedBy?: string;
  updateRequestedAt?: Date;
  updateRequestDescription?: string;
  requestedVersion?: string;
}

interface Message {
  id: string;
  text: string;
  sender: 'advisor' | 'client';
  timestamp: Date;
  documentId: string;
}

// Reports prepared by advisor are represented using shared `documents` with folder 'Reports'

import { mockClients } from '@/utils/mockData';

const mockClientDocuments: ClientDocument[] = [
  // Bank Statements - Multiple years
  {
    id: '1',
    name: 'Bank Statement June 2024.pdf',
    type: 'pdf',
    uploadedAt: new Date(2024, 5, 5, 14, 30),
    size: '890 KB',
    status: 'pending'
  },
  {
    id: '1a',
    name: 'Bank Statement June 2023.pdf',
    type: 'pdf',
    uploadedAt: new Date(2023, 5, 5, 14, 30),
    size: '850 KB',
    status: 'reviewed'
  },
  {
    id: '1b',
    name: 'Bank Statement June 2025.pdf',
    type: 'pdf',
    uploadedAt: new Date(2025, 5, 5, 14, 30),
    size: '920 KB',
    status: 'reviewed'
  },
  // Tax Returns - Multiple years
  {
    id: '2',
    name: 'Tax Return 2024.pdf',
    type: 'pdf',
    uploadedAt: new Date(2024, 6, 3, 10, 15),
    size: '1.2 MB',
    status: 'reviewed'
  },
  {
    id: '2a',
    name: 'Tax Return 2023.pdf',
    type: 'pdf',
    uploadedAt: new Date(2023, 6, 3, 10, 15),
    size: '1.1 MB',
    status: 'reviewed'
  },
  {
    id: '2b',
    name: 'Tax Return 2025.pdf',
    type: 'pdf',
    uploadedAt: new Date(2025, 6, 3, 10, 15),
    size: '1.3 MB',
    status: 'pending'
  },
  // Investment Goals - Multiple years
  {
    id: '3',
    name: 'Investment Goals 2024.docx',
    type: 'docx',
    uploadedAt: new Date(2024, 6, 2, 16, 20),
    size: '245 KB',
    status: 'needs_update'
  },
  {
    id: '3a',
    name: 'Investment Goals 2023.docx',
    type: 'docx',
    uploadedAt: new Date(2023, 6, 2, 16, 20),
    size: '230 KB',
    status: 'reviewed'
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

// Using shared documents store for prepared materials

interface AdvisorDashboardProps {
  initialClientId?: string;
}

const AdvisorDashboard = ({ initialClientId }: AdvisorDashboardProps) => {
  const initialIndex = React.useMemo(() => {
    if (!initialClientId) return 0;
    const idx = mockClients.findIndex(c => c.id === initialClientId);
    return idx >= 0 ? idx : 0;
  }, [initialClientId]);
  const [currentClientIndex, setCurrentClientIndex] = useState(initialIndex);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [isRequestPopupOpen, setIsRequestPopupOpen] = useState(false);
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>([]);
  const { documents, requestDocument, requestDocumentUpdate, updateRequestFrequency, deleteRequestedDocument } = useDocumentsStore();
  const [requestInitialName, setRequestInitialName] = useState<string | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<any>(null);
  const [isRequestedDocumentsOpen, setIsRequestedDocumentsOpen] = useState(true);
  const [clientDocuments, setClientDocuments] = useState<ClientDocument[]>(mockClientDocuments);
  const [selectedYearByDoc, setSelectedYearByDoc] = useState<Record<string, number>>({});
  const [selectedPeriodByDoc, setSelectedPeriodByDoc] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  
  const currentClient = mockClients[currentClientIndex];

  // Time period navigation component for document groups
  const TimeNavigation = ({ baseName, docs, tone }: { baseName: string; docs: any[]; tone: 'blue' | 'green' | 'orange' }) => {
    const years = [...new Set(docs.map(doc => {
      const date = doc.uploadedAt || doc.requestedAt;
      return new Date(date).getFullYear();
    }))].sort((a, b) => b - a);
    const currentYear = selectedYearByDoc[baseName] || years[0];
    const currentIndex = years.indexOf(currentYear);
    
    const goToPreviousYear = () => {
      if (currentIndex < years.length - 1) {
        setSelectedYearByDoc(prev => ({ ...prev, [baseName]: years[currentIndex + 1] }));
      }
    };
    
    const goToNextYear = () => {
      if (currentIndex > 0) {
        setSelectedYearByDoc(prev => ({ ...prev, [baseName]: years[currentIndex - 1] }));
      }
    };

    const buttonClass = tone === 'blue' 
      ? 'border-blue-300 text-blue-700 hover:bg-blue-50' 
      : tone === 'green'
      ? 'border-green-300 text-green-700 hover:bg-green-50'
      : 'border-orange-300 text-orange-700 hover:bg-orange-50';

    return (
      <div className="flex items-center gap-1 md:gap-2">
        <Button
          variant="outline"
          size="icon"
          className={`h-7 w-7 md:h-8 md:w-8 rounded-full ${buttonClass}`}
          onClick={goToPreviousYear}
          disabled={currentIndex >= years.length - 1}
        >
          <ChevronLeft className={`h-3 w-3 md:h-4 md:w-4 ${tone === 'blue' ? 'text-blue-600' : tone === 'green' ? 'text-green-600' : 'text-orange-600'}`} />
        </Button>
        
        <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-xs md:text-sm ${
          tone === 'blue' ? 'bg-blue-100 text-blue-800' : tone === 'green' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
        }`}>
          {currentYear}
        </div>
        
        <Button
          variant="outline"
          size="icon"
          className={`h-7 w-7 md:h-8 md:w-8 rounded-full ${buttonClass}`}
          onClick={goToNextYear}
          disabled={currentIndex <= 0}
        >
          <ChevronRight className={`h-3 w-3 md:h-4 md:w-4 ${tone === 'blue' ? 'text-blue-600' : tone === 'green' ? 'text-green-600' : 'text-orange-600'}`} />
        </Button>
      </div>
    );
  };

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

  const handleRequestUpdate = (doc: ClientDocument) => {
    // Extract current year from document name or use current year
    const currentYear = new Date().getFullYear();
    const docYear = doc.name.match(/\b(19|20)\d{2}\b/);
    const nextYear = docYear ? parseInt(docYear[0]) + 1 : currentYear;
    
    // Update the client document state
    setClientDocuments(prev => prev.map(clientDoc => 
      clientDoc.id === doc.id 
        ? {
            ...clientDoc,
            hasUpdateRequest: true,
            updateRequestedBy: 'John Smith',
            updateRequestedAt: new Date(),
            updateRequestDescription: `Please upload the updated version of ${doc.name} for ${nextYear}.`,
            requestedVersion: nextYear.toString()
          }
        : clientDoc
    ));

    toast({
      title: 'Update Requested',
      description: `Update request sent for ${doc.name} (${nextYear} version)`,
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

  const handleDocumentRequest = (request: Omit<DocumentRequest, 'id' | 'requestedAt' | 'status'>) => {
    const created = requestDocument(request);
    setDocumentRequests(prev => [...prev, created]);
    toast({
      title: "Document Requested",
      description: `Request for "${request.documentName}" (${request.frequency}) has been sent to the client`,
    });
  };

  const handleDeleteClick = (doc: any) => {
    setDocumentToDelete(doc);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (documentToDelete) {
      deleteRequestedDocument(documentToDelete.id);
      setDocumentToDelete(null);
      toast({
        title: 'Request Deleted',
        description: `Request for ${documentToDelete.name} has been deleted.`,
      });
    }
    setDeleteDialogOpen(false);
  };

  const getNextDueDate = (uploadedAt: Date, frequency?: RequestFrequency): Date | null => {
    if (!frequency || frequency === 'one-time') return null;
    const next = new Date(uploadedAt);
    switch (frequency) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        return null;
    }
    return next;
  };

  // Calendar removed from AdvisorDashboard; lives on /overview page

  const selectedDocument = clientDocuments.find(doc => doc.id === selectedDocumentId) || 
                          documents.find(doc => doc.id === selectedDocumentId);
  const documentMessages = messages.filter(msg => msg.documentId === selectedDocumentId);

  // Debug logging for selectedDocumentId
  React.useEffect(() => {
    console.log('Selected Document ID changed:', selectedDocumentId);
    console.log('Selected Document object:', selectedDocument);
    console.log('Document Messages:', documentMessages);
  }, [selectedDocumentId, selectedDocument, documentMessages]);

  // Additional debugging for component re-renders
  React.useEffect(() => {
    console.log('AdvisorDashboard component rendered');
  });

  // Auto-expand Requested Documents when no document is selected
  React.useEffect(() => {
    if (!selectedDocumentId) {
      setIsRequestedDocumentsOpen(true);
    }
  }, [selectedDocumentId]);



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
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-center">
                    <Upload className="h-5 w-5 text-blue-600 mx-auto mb-1 group-hover:text-blue-700" />
                    <span className="text-xs text-blue-700 font-medium">Drop files or click</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      toast({
                        title: files.length > 1 ? 'Files Selected' : 'File Selected',
                        description: files.length > 1 ? `${files.length} files chosen.` : `${files[0].name}`,
                      });
                    }}
                  />
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
              <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300 ml-2">
                Files uploaded by clients
              </Badge>
              <div className="ml-auto flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsRequestPopupOpen(true)}
                  className="bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
                <UIButton
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/settings')}
                  className="bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
                >
                  Presets
                </UIButton>
                                 {selectedDocumentId && (
                   <Button 
                     variant="outline" 
                     size="sm" 
                     onClick={() => {
                       setSelectedDocumentId(null);
                       // Auto-expand the Requested Documents section when closing messages
                       setIsRequestedDocumentsOpen(true);
                     }}
                   >
                     Close Messages
                   </Button>
                 )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-6">
              {/* Client Document Uploads Carousel - Grouped by type */}
              <div className="space-y-4">
                {Array.from(groupDocumentsByBaseNameMap(clientDocuments).entries()).length > 0 ? (
                  <Carousel
                    opts={{
                      align: "start",
                      loop: false,
                    }}
                    className="w-full"
                  >
                    <CarouselContent className="-ml-4">
                      {Array.from(groupDocumentsByBaseNameMap(clientDocuments).entries()).map(([baseName, docs]) => {
                        const sortedDocs = docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
                        return (
                          <CarouselItem key={baseName} className="pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                            <div className="border rounded-lg overflow-hidden bg-white">
                              <div className="p-3 bg-blue-50/60 border-b border-blue-200">
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <h3 className="font-medium text-blue-900">{baseName}</h3>
                                    <p className="text-sm text-blue-700">{sortedDocs.length} document{sortedDocs.length > 1 ? 's' : ''}</p>
                                  </div>
                                  <TimeNavigation baseName={baseName} docs={sortedDocs} tone="blue" />
                                </div>
                              </div>
                              
                              <div className="p-4 space-y-3">
                                {(() => {
                                  const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.uploadedAt).getFullYear()))].sort((a, b) => b - a);
                                  const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                  const filteredDocs = sortedDocs.filter(doc => 
                                    new Date(doc.uploadedAt).getFullYear() === selectedYear
                                  );
                                  return filteredDocs.slice(0, 3).map((doc, index) => (
                                  <div key={doc.id} className={`p-3 border rounded-lg hover:bg-gray-50 transition-colors ${
                                    selectedDocumentId === doc.id ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
                                  }`}>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                        <div className="min-w-0">
                                          <h4 className="font-medium text-gray-900 text-sm truncate">{doc.name}</h4>
                                          <p className="text-xs text-gray-500">
                                            {doc.size} • {doc.uploadedAt.toLocaleDateString()}
                                          </p>
                                          {index === 0 && (
                                            <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-300 mt-1">
                                              Latest
                                            </Badge>
                                          )}
                                          {doc.hasUpdateRequest && (
                                            <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300 mt-1">
                                              Update requested
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                      <Badge className={getStatusBadgeColor(doc.status) + " text-xs"}>
                                        {doc.status.replace('_', ' ')}
                                      </Badge>
                                    </div>
                                    
                                    <div className="flex gap-1">
                                      <Button 
                                        size="sm" 
                                        variant={selectedDocumentId === doc.id ? "default" : "outline"}
                                        onClick={() => {
                                          const newSelectedId = selectedDocumentId === doc.id ? null : doc.id;
                                          setSelectedDocumentId(newSelectedId);
                                          if (newSelectedId) {
                                            setIsRequestedDocumentsOpen(false);
                                          }
                                        }}
                                        className="text-xs flex-1"
                                      >
                                        <MessageSquare className="h-3 w-3 mr-1" />
                                        Messages
                                      </Button>
                                      
                                      <Button 
                                        size="sm" 
                                        variant="outline"
                                        onClick={() => handleDocumentAction(doc.id, 'reviewed')}
                                        className="text-xs"
                                      >
                                        Review
                                      </Button>
                                    </div>
                                  </div>
                                  ));
                                })()}
                                
                                {(() => {
                                  const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.uploadedAt).getFullYear()))].sort((a, b) => b - a);
                                  const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                  const filteredDocs = sortedDocs.filter(doc => 
                                    new Date(doc.uploadedAt).getFullYear() === selectedYear
                                  );
                                  return filteredDocs.length > 3 && (
                                    <p className="text-xs text-gray-500 text-center mt-2">
                                      +{filteredDocs.length - 3} more documents
                                    </p>
                                  );
                                })()}
                              </div>
                            </div>
                          </CarouselItem>
                        );
                      })}
                    </CarouselContent>
                    <CarouselPrevious className="absolute left-2 top-1/2 -translate-y-1/2" />
                    <CarouselNext className="absolute right-2 top-1/2 -translate-y-1/2" />
                  </Carousel>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No client uploads yet</p>
                  </div>
                )}
              </div>

                               {/* Requested Documents Admin View */}
                <div className="space-y-4">
                  <Collapsible open={isRequestedDocumentsOpen} onOpenChange={setIsRequestedDocumentsOpen}>
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full justify-between p-0 h-auto hover:bg-transparent"
                      >
                        <h3 className="text-lg font-semibold text-gray-900">Requested Documents</h3>
                        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${isRequestedDocumentsOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 mt-4">
                      {Array.from(groupDocumentsByBaseNameMap(documents.filter(d => d.isRequested && !d.url)).entries()).length > 0 ? (
                        <Carousel
                          opts={{
                            align: "start",
                            loop: false,
                          }}
                          className="w-full"
                        >
                          <CarouselContent className="-ml-4">
                            {Array.from(groupDocumentsByBaseNameMap(documents.filter(d => d.isRequested && !d.url)).entries()).map(([baseName, docs]) => {
                              const sortedDocs = docs.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
                              return (
                                <CarouselItem key={baseName} className="pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                                  <div className="border rounded-lg overflow-hidden bg-orange-50/20">
                                    <div className="p-3 bg-orange-50/60 border-b border-orange-200">
                                      <div className="flex items-center justify-between mb-2">
                                        <div>
                                          <h3 className="font-medium text-orange-900">{baseName}</h3>
                                          <p className="text-sm text-orange-700">{sortedDocs.length} request{sortedDocs.length > 1 ? 's' : ''}</p>
                                        </div>
                                        <TimeNavigation baseName={baseName} docs={sortedDocs} tone="orange" />
                                      </div>
                                    </div>
                                    
                                    <div className="p-4 space-y-3">
                                      {(() => {
                                        const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.requestedAt || 0).getFullYear()))].sort((a, b) => b - a);
                                        const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                        const filteredDocs = sortedDocs.filter(doc => 
                                          new Date(doc.requestedAt || 0).getFullYear() === selectedYear
                                        );
                                        return filteredDocs.slice(0, 3).map((doc, index) => (
                                          <div key={doc.id} className="p-3 border rounded-lg bg-white/80 border-orange-200">
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <FileText className="h-4 w-4 text-orange-600 flex-shrink-0" />
                                                <div className="min-w-0">
                                                  <h4 className="font-medium text-orange-900 text-sm truncate">{doc.name}</h4>
                                                  <p className="text-xs text-orange-700">
                                                    Requested {doc.requestedAt?.toLocaleDateString()} by {doc.requestedBy}
                                                  </p>
                                                  {index === 0 && (
                                                    <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300 mt-1">
                                                      Latest Request
                                                    </Badge>
                                                  )}
                                                </div>
                                              </div>
                                              <Badge className="text-xs bg-orange-200 text-orange-800">
                                                {doc.requestFrequency ? doc.requestFrequency.charAt(0).toUpperCase() + doc.requestFrequency.slice(1) : 'One-time'}
                                              </Badge>
                                            </div>
                                            
                                            <div className="flex gap-1">
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <Button variant="outline" size="sm" className="text-xs flex-1">
                                                    Manage ⋮
                                                  </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                  <DropdownMenuItem onClick={() => updateRequestFrequency(doc.id, 'monthly')}>Monthly</DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => updateRequestFrequency(doc.id, 'quarterly')}>Quarterly</DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => updateRequestFrequency(doc.id, 'yearly')}>Yearly</DropdownMenuItem>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem 
                                                    onClick={() => handleDeleteClick(doc)}
                                                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                                  >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Delete Request
                                                  </DropdownMenuItem>
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                            
                                            {doc.description && (
                                              <p className="text-xs text-orange-800 mt-2">{doc.description}</p>
                                            )}
                                          </div>
                                        ));
                                      })()}
                                      
                                      {(() => {
                                        const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.requestedAt || 0).getFullYear()))].sort((a, b) => b - a);
                                        const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                        const filteredDocs = sortedDocs.filter(doc => 
                                          new Date(doc.requestedAt || 0).getFullYear() === selectedYear
                                        );
                                        return filteredDocs.length > 3 && (
                                          <p className="text-xs text-gray-500 text-center mt-2">
                                            +{filteredDocs.length - 3} more requests
                                          </p>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </CarouselItem>
                              );
                            })}
                          </CarouselContent>
                          <CarouselPrevious className="absolute left-2 top-1/2 -translate-y-1/2" />
                          <CarouselNext className="absolute right-2 top-1/2 -translate-y-1/2" />
                        </Carousel>
                      ) : (
                        <div className="text-center py-8">
                          <FileText className="h-12 w-12 text-orange-300 mx-auto mb-4" />
                          <p className="text-orange-600">No document requests yet</p>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                {/* Documents Needed Section - Now at bottom of Client Document Uploads */}
                <div className="mt-6">
                  <DocumentsNeeded clientId={currentClient.id} advisorName="John Smith" />
                </div>
             </div>
          </CardContent>
        </Card>

        {/* Messages Section - Now independent and always visible when document is selected */}
        {selectedDocumentId && selectedDocument ? (
          <Card className="mb-6 border-blue-200 shadow-lg relative z-10 bg-white" 
                style={{ 
                  display: 'block', 
                  position: 'relative', 
                  zIndex: 10,
                  visibility: 'visible',
                  opacity: 1
                }}>
            <CardHeader className="bg-gradient-to-r from-blue-100 to-blue-50 border-b border-blue-200">
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <MessageSquare className="h-5 w-5" />
                Messages: {selectedDocument.name}
                {selectedDocument && documents.find(d => d.id === selectedDocumentId) && (
                  <Badge className="text-xs bg-green-100 text-green-700 border-green-300">
                    Deliverable
                  </Badge>
                )}
                <div className="ml-auto">
                                     <Button 
                     variant="outline" 
                     size="sm" 
                     onClick={() => {
                       console.log('Close messages button clicked, setting selectedDocumentId to null');
                       setSelectedDocumentId(null);
                       // Auto-expand the Requested Documents section when closing messages
                       setIsRequestedDocumentsOpen(true);
                     }}
                     className="bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
                   >
                    Close Messages
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col h-[70vh] md:h-96">
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
                    placeholder={`Type your message about ${selectedDocument.name}...`}
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
            </CardContent>
          </Card>
        ) : (
          /* Fallback when no document is selected */
          <div className="mb-6 p-4 text-center text-gray-500 text-sm">
            Select a document to view messages
          </div>
        )}



        {/* Generated Reports - Bottom Section */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-green-100 to-green-50 border-b border-green-200">
            <CardTitle className="flex items-center gap-2 text-green-900">
              <FileText className="h-5 w-5" />
              Deliverables
              <Badge className="text-xs bg-green-100 text-green-700 border-green-300 ml-2">
                Files shared by advisor
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {/* Deliverables Carousel - Grouped by type */}
            <div className="space-y-4">
              {Array.from(groupDocumentsByBaseNameMap(documents.filter(d => d.folder === 'Reports')).entries()).length > 0 ? (
                <Carousel
                  opts={{
                    align: "start",
                    loop: false,
                  }}
                  className="w-full"
                >
                  <CarouselContent className="-ml-4">
                    {Array.from(groupDocumentsByBaseNameMap(documents.filter(d => d.folder === 'Reports')).entries()).map(([baseName, docs]) => {
                      const sortedDocs = docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
                      return (
                        <CarouselItem key={baseName} className="pl-4 basis-full md:basis-1/2 lg:basis-1/3">
                          <div className="border rounded-lg overflow-hidden bg-white">
                            <div className="p-3 bg-green-50/60 border-b border-green-200">
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <h3 className="font-medium text-green-900">{baseName}</h3>
                                  <p className="text-sm text-green-700">{sortedDocs.length} deliverable{sortedDocs.length > 1 ? 's' : ''}</p>
                                </div>
                                <TimeNavigation baseName={baseName} docs={sortedDocs} tone="green" />
                              </div>
                            </div>
                            
                            <div className="p-4 space-y-3">
                              {(() => {
                                const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.uploadedAt).getFullYear()))].sort((a, b) => b - a);
                                const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                const filteredDocs = sortedDocs.filter(doc => 
                                  new Date(doc.uploadedAt).getFullYear() === selectedYear
                                );
                                return filteredDocs.slice(0, 3).map((doc, index) => (
                                <div key={doc.id} className={`p-3 border rounded-lg hover:bg-gray-50 transition-colors ${
                                  selectedDocumentId === doc.id ? 'border-green-300 bg-green-50/30' : 'border-gray-200'
                                }`}>
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <FileText className="h-4 w-4 text-green-600 flex-shrink-0" />
                                      <div className="min-w-0">
                                        <h4 className="font-medium text-gray-900 text-sm truncate">{(doc as any).name}</h4>
                                        <p className="text-xs text-gray-500">
                                          Generated {(doc as any).uploadedAt.toLocaleDateString()}
                                        </p>
                                        {index === 0 && (
                                          <Badge className="text-xs bg-green-100 text-green-700 border-green-300 mt-1">
                                            Latest
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <Badge className="text-xs bg-green-100 text-green-700 border-green-300">
                                      deliverable
                                    </Badge>
                                  </div>
                                  
                                  <div className="flex gap-1">
                                    <Button 
                                      size="sm" 
                                      variant={selectedDocumentId === doc.id ? "default" : "outline"}
                                      onClick={() => {
                                        const newSelectedId = selectedDocumentId === doc.id ? null : doc.id;
                                        setSelectedDocumentId(newSelectedId);
                                        if (newSelectedId) {
                                          setIsRequestedDocumentsOpen(false);
                                        }
                                      }}
                                      className="text-xs flex-1"
                                    >
                                      <MessageSquare className="h-3 w-3 mr-1" />
                                      Messages
                                    </Button>
                                    
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      <CheckCircle className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                                ));
                              })()}
                              
                              {(() => {
                                const availableYears = [...new Set(sortedDocs.map(doc => new Date(doc.uploadedAt).getFullYear()))].sort((a, b) => b - a);
                                const selectedYear = selectedYearByDoc[baseName] || availableYears[0];
                                const filteredDocs = sortedDocs.filter(doc => 
                                  new Date(doc.uploadedAt).getFullYear() === selectedYear
                                );
                                return filteredDocs.length > 3 && (
                                  <p className="text-xs text-gray-500 text-center mt-2">
                                    +{filteredDocs.length - 3} more deliverables
                                  </p>
                                );
                              })()}
                            </div>
                          </div>
                        </CarouselItem>
                      );
                    })}
                  </CarouselContent>
                  <CarouselPrevious className="absolute left-2 top-1/2 -translate-y-1/2" />
                  <CarouselNext className="absolute right-2 top-1/2 -translate-y-1/2" />
                </Carousel>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No deliverables created yet</p>
                </div>
              )}
            </div>

             {/* Documents Due Section */}
             <div className="mb-6">
               <h3 className="text-xs font-semibold text-gray-800 mb-3">Documents Due</h3>
               <div className="p-4 border rounded-lg bg-red-50/40 border-red-200">
                 <div className="flex items-start justify-between gap-4">
                   <div className="flex items-center gap-3 min-w-0 flex-1">
                     <FileText className="h-5 w-5 text-red-600 flex-shrink-0" />
                     <div className="min-w-0">
                       <h4 className="font-medium text-red-900 truncate">Tax Returns 2023.pdf</h4>
                       <p className="text-xs text-red-700">
                         3.2 MB • Uploaded 3/15/2024 • Documents
                       </p>
                       <div className="mt-1 text-xs text-red-800">
                         <span className="font-medium">Sarah Johnson</span> Requesting 2024 version
                       </div>
                     </div>
                   </div>
                   <div className="flex items-center gap-2 flex-shrink-0">
                     <Badge className="bg-red-200 text-red-800">Update Request</Badge>
                   </div>
                 </div>
                 <div className="text-xs text-red-800 mt-2">
                   Requested by John Smith on 7/8/2024
                 </div>
               </div>
             </div>

             <div className="mt-6">
              <PreparedMaterials clientId={currentClient.id} advisorName="John Smith" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Request Document Popup */}
        <RequestDocumentPopup
        isOpen={isRequestPopupOpen}
        onClose={() => setIsRequestPopupOpen(false)}
        onSubmit={handleDocumentRequest}
        clientId={currentClient.id}
        advisorName="John Smith" // This would typically come from auth context
          initialDocumentName={requestInitialName}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the request for "{documentToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Delete Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdvisorDashboard;