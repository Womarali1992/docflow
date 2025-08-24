import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreVertical, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { RequestFrequency } from '@/types/dashboard';
import { FileText, Download, Search, Folder } from 'lucide-react';
import { Document } from '@/types/dashboard';
interface DocumentLibraryProps {
  documents: Document[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSelectDocument?: (doc: Document) => void;
  canManageRequests?: boolean;
  showDateFilter?: boolean;
}
const DocumentLibrary = ({
  documents,
  searchTerm,
  onSearchChange,
  onSelectDocument,
  canManageRequests = false,
  showDateFilter = false
}: DocumentLibraryProps) => {
  const { updateRequestFrequency, deleteRequestedDocument } = useDocumentsStore();
  const [selectedDate, setSelectedDate] = React.useState<string>('all');
  const [selectedYearByDoc, setSelectedYearByDoc] = React.useState<Record<string, number>>({});
  const [selectedPeriodByDoc, setSelectedPeriodByDoc] = React.useState<Record<string, string>>({});
  const [selectedQuarterByDoc, setSelectedQuarterByDoc] = React.useState<Record<string, string>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [documentToDelete, setDocumentToDelete] = React.useState<Document | null>(null);

  // Inline component: simple left/right year switcher (carousel-style)
  const YearCarousel = ({ docId, years, tone }: { docId: string; years: number[]; tone: 'orange' | 'blue' }) => {
    const selected = selectedYearByDoc[docId];
    const currentIndex = selected ? Math.max(0, years.indexOf(selected)) : years.length - 1;

    React.useEffect(() => {
      if (!selected && years.length > 0) {
        setSelectedYearByDoc(prev => ({ ...prev, [docId]: years[years.length - 1] }));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId, years]);

    const isOrange = tone === 'orange';
    const badgeBase = isOrange ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800';
    const arrowClass = isOrange
      ? 'border-orange-300 text-orange-700 hover:bg-orange-50'
      : 'border-blue-300 text-blue-700 hover:bg-blue-50';

    const goPrev = (e: React.MouseEvent) => {
      e.stopPropagation();
      const nextIdx = Math.max(0, currentIndex - 1);
      setSelectedYearByDoc(prev => ({ ...prev, [docId]: years[nextIdx] }));
    };
    const goNext = (e: React.MouseEvent) => {
      e.stopPropagation();
      const nextIdx = Math.min(years.length - 1, currentIndex + 1);
      setSelectedYearByDoc(prev => ({ ...prev, [docId]: years[nextIdx] }));
    };

    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goPrev}
          disabled={currentIndex <= 0}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={`px-3 py-1 rounded-full text-sm ${badgeBase}`}>
          {years[currentIndex] ?? ''}
        </div>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goNext}
          disabled={currentIndex >= years.length - 1}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  // Inline component: quarter switcher
  const QuarterCarousel = ({ docId, tone, initialQuarter = 'Q1' }: { docId: string; tone: 'orange' | 'blue'; initialQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' }) => {
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const selectedQuarter = selectedQuarterByDoc[docId];
    const currentIndex = selectedQuarter ? Math.max(0, quarters.indexOf(selectedQuarter)) : 0;

    React.useEffect(() => {
      if (!selectedQuarter) {
        setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: initialQuarter }));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId, initialQuarter]);

    const isOrange = tone === 'orange';
    const badgeBase = isOrange ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800';
    const arrowClass = isOrange
      ? 'border-orange-300 text-orange-700 hover:bg-orange-50'
      : 'border-blue-300 text-blue-700 hover:bg-blue-50';

    const goPrev = (e: React.MouseEvent) => {
      e.stopPropagation();
      const nextIdx = Math.max(0, currentIndex - 1);
      setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: quarters[nextIdx] }));
    };
    const goNext = (e: React.MouseEvent) => {
      e.stopPropagation();
      const nextIdx = Math.min(quarters.length - 1, currentIndex + 1);
      setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: quarters[nextIdx] }));
    };

    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goPrev}
          disabled={currentIndex <= 0}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={`px-3 py-1 rounded-full text-sm ${badgeBase}`}>
          {quarters[currentIndex]}
        </div>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goNext}
          disabled={currentIndex >= quarters.length - 1}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const getInitialQuarterForDoc = (doc: Document): 'Q1' | 'Q2' | 'Q3' | 'Q4' => {
    const month = doc.uploadedAt.getMonth(); // 0-11
    const qIndex = Math.floor(month / 3); // 0-3
    return (['Q1', 'Q2', 'Q3', 'Q4'] as const)[qIndex];
  };

  const getMonthsForQuarter = (quarter: string): string[] => {
    switch (quarter) {
      case 'Q1':
        return ['Jan', 'Feb', 'Mar'];
      case 'Q2':
        return ['Apr', 'May', 'Jun'];
      case 'Q3':
        return ['Jul', 'Aug', 'Sep'];
      case 'Q4':
        return ['Oct', 'Nov', 'Dec'];
      default:
        return ['Jan', 'Feb', 'Mar'];
    }
  };

  const getDisplayName = React.useCallback((doc: Document) => {
    const selectedYear = selectedYearByDoc[doc.id];
    const selectedPeriod = selectedPeriodByDoc[doc.id];

    let name = doc.name;

    // Replace or append year
    if (selectedYear) {
      const yearPattern = /\b(19|20)\d{2}\b/;
      if (yearPattern.test(name)) {
        name = name.replace(yearPattern, String(selectedYear));
      } else {
        const lastDotIndex = name.lastIndexOf('.');
        if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
          const base = name.slice(0, lastDotIndex);
          const ext = name.slice(lastDotIndex);
          name = `${base} ${selectedYear}${ext}`;
        } else {
          name = `${name} ${selectedYear}`;
        }
      }
    }

    // Replace or append period (quarters or months)
    if (selectedPeriod) {
      const quarterPattern = /\bQ[1-4]\b/;
      const monthPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

      if (quarterPattern.test(name)) {
        name = name.replace(quarterPattern, selectedPeriod);
      } else if (monthPattern.test(name)) {
        name = name.replace(monthPattern, selectedPeriod);
      } else {
        const lastDotIndex = name.lastIndexOf('.');
        if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
          const base = name.slice(0, lastDotIndex);
          const ext = name.slice(lastDotIndex);
          name = `${base} ${selectedPeriod}${ext}`;
        } else {
          name = `${name} ${selectedPeriod}`;
        }
      }
    }

    return name;
  }, [selectedYearByDoc, selectedPeriodByDoc]);

  const availableDates = React.useMemo(() => {
    const set = new Set<string>();
    documents.forEach(doc => {
      const isRequested = doc.isRequested && !doc.url;
      const date = (isRequested && doc.requestedAt) ? doc.requestedAt : doc.uploadedAt;
      if (date) set.add(date.toLocaleDateString());
    });
    return Array.from(set);
  }, [documents]);

  const filteredDocuments = documents.filter(doc => {
    const matchesText = doc.name.toLowerCase().includes(searchTerm.toLowerCase()) || doc.folder.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesText) return false;
    if (selectedDate === 'all') return true;
    const isRequested = doc.isRequested && !doc.url;
    const date = (isRequested && doc.requestedAt) ? doc.requestedAt : doc.uploadedAt;
    return date ? date.toLocaleDateString() === selectedDate : false;
  });

  const getYearsForDoc = (doc: Document) => {
    const nowYear = new Date().getFullYear();
    const baseYear = (doc.isRequested && !doc.url && doc.requestedAt) ? doc.requestedAt.getFullYear() : doc.uploadedAt.getFullYear();
    const candidates = [nowYear, nowYear - 1, baseYear];
    return Array.from(new Set(candidates)).sort((a, b) => a - b);
  };

  const getPeriodsForDoc = (doc: Document) => {
    // Use quarters as the lowest time option when a frequency exists
    if (doc.requestFrequency) return ['Q1', 'Q2', 'Q3', 'Q4'];
    return [];
  };
  
  const handleDownload = (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the document selection
    if (doc.url) {
      const link = document.createElement('a');
      link.href = doc.url;
      link.download = doc.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleDeleteClick = (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocumentToDelete(doc);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (documentToDelete) {
      deleteRequestedDocument(documentToDelete.id);
      setDocumentToDelete(null);
    }
    setDeleteDialogOpen(false);
  };


  return <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">My Uploads

        </h3>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <Input placeholder="Search documents..." value={searchTerm} onChange={e => onSearchChange(e.target.value)} className="pl-10 w-64 border-gray-200 rounded-xl focus:border-blue-300 focus:ring-blue-300" />
          </div>
          {showDateFilter && (
            <div className="w-48">
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dates</SelectItem>
                  {availableDates.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
      
      {/* Separate uploaded documents and requested documents */}
      {(() => {
        const uploadedDocs = filteredDocuments.filter(doc => !(doc.isRequested && !doc.url) && !(doc.hasUpdateRequest && doc.url));
        const requestedDocs = filteredDocuments.filter(doc => (doc.isRequested && !doc.url) || (doc.hasUpdateRequest && doc.url));
        
        return (
          <div className="space-y-6">


            {/* Uploaded Documents - 2 columns even on mobile */}
            {uploadedDocs.length > 0 && (
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-4">Uploaded Documents</h4>
                <div className="grid grid-cols-2 gap-4">
                  {uploadedDocs.map(doc => {
                    return (
                      <div 
                        key={doc.id} 
                        className="p-4 rounded-xl transition-all duration-200 cursor-pointer border border-gray-200 bg-gray-50 hover:bg-white hover:shadow-md"
                        onClick={() => onSelectDocument && onSelectDocument(doc)}
                      >
                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg shadow-sm flex items-center justify-center bg-white">
                            <FileText className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            {doc.requestFrequency ? (
                              doc.requestFrequency === 'monthly' ? (
                                getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc)).map((m) => {
                                  const active = selectedPeriodByDoc[doc.id] === m;
                                  const cls = `cursor-pointer ${active ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-800'}`;
                                  return (
                                    <Badge
                                      key={m}
                                      onClick={(e) => { e.stopPropagation(); setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: active ? '' : m })); }}
                                      className={cls}
                                    >
                                      {m}
                                    </Badge>
                                  );
                                })
                              ) : (
                                getPeriodsForDoc(doc).map((p) => {
                                  const active = selectedPeriodByDoc[doc.id] === p;
                                  const cls = `cursor-pointer ${active ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-800'}`;
                                  return (
                                    <Badge
                                      key={p}
                                      onClick={(e) => { e.stopPropagation(); setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: active ? '' : p })); }}
                                      className={cls}
                                    >
                                      {p}
                                    </Badge>
                                  );
                                })
                              )
                            ) : null}
                          </div>
                          <div className="justify-self-end">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-2"
                              onClick={(e) => handleDownload(doc, e)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {doc.requestFrequency ? (
                          <>
                            <div className="mt-1 flex items-center justify-center mb-3">
                              {doc.requestFrequency === 'monthly' ? (
                                <QuarterCarousel docId={doc.id} tone="blue" initialQuarter={getInitialQuarterForDoc(doc)} />
                              ) : (
                                <YearCarousel docId={doc.id} years={getYearsForDoc(doc)} tone="blue" />
                              )}
                            </div>
                          </>
                        ) : null}
                        
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold line-clamp-2 text-gray-800">
                            {getDisplayName(doc)}
                          </h4>
                          
                          <p className="text-xs text-gray-500">{doc.size}</p>
                          <p className="text-xs text-gray-500">{doc.uploadedAt.toLocaleDateString()}</p>
                          
                          <div className="space-y-1 pt-2">
                            <Badge variant="outline" className="text-xs bg-white border-gray-300 flex items-center gap-1">
                              <Folder className="h-3 w-3" />
                              {doc.folder}
                            </Badge>
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                              {doc.uploadedBy}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Requested Documents - 1 column (includes both requested and update requests) */}
            {requestedDocs.length > 0 && (
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-4">Requested Documents</h4>
                <div className="grid grid-cols-1 gap-4">
                  {requestedDocs.map(doc => {
                    const isRequested = doc.isRequested && !doc.url;
                    const hasUpdateRequest = doc.hasUpdateRequest && doc.url;
                    
                    return (
                      <div 
                        key={doc.id} 
                        className={`p-4 rounded-xl transition-all duration-200 cursor-pointer ${
                          isRequested 
                            ? 'border-2 border-dashed border-orange-300 bg-orange-50/30 hover:bg-orange-50/50'
                            : 'border border-gray-200 bg-gray-50 hover:bg-white hover:shadow-md'
                        }`}
                        onClick={() => onSelectDocument && onSelectDocument(doc)}
                      >
                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 mb-3">
                          <div className={`w-10 h-10 rounded-lg shadow-sm flex items-center justify-center ${
                            isRequested ? 'bg-orange-100' : 'bg-white'
                          }`}>
                            <FileText className={`h-5 w-5 ${isRequested ? 'text-orange-600' : 'text-blue-600'}`} />
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            {doc.requestFrequency ? (
                              doc.requestFrequency === 'monthly' ? (
                                getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc)).map((m) => {
                                  const active = selectedPeriodByDoc[doc.id] === m;
                                  const cls = `cursor-pointer ${active ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-800'}`;
                                  return (
                                    <Badge
                                      key={m}
                                      onClick={(e) => { e.stopPropagation(); setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: active ? '' : m })); }}
                                      className={cls}
                                    >
                                      {m}
                                    </Badge>
                                  );
                                })
                              ) : (
                                getPeriodsForDoc(doc).map((p) => {
                                  const active = selectedPeriodByDoc[doc.id] === p;
                                  const cls = `cursor-pointer ${active ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-800'}`;
                                  return (
                                    <Badge
                                      key={p}
                                      onClick={(e) => { e.stopPropagation(); setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: active ? '' : p })); }}
                                      className={cls}
                                    >
                                      {p}
                                    </Badge>
                                  );
                                })
                              )
                            ) : null}
                          </div>
                          <div className="justify-self-end">
                            {isRequested && canManageRequests ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-100/50">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateRequestFrequency(doc.id, 'monthly'); }}>Monthly</DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateRequestFrequency(doc.id, 'quarterly'); }}>Quarterly</DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateRequestFrequency(doc.id, 'yearly'); }}>Yearly</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem 
                                    onClick={(e) => handleDeleteClick(doc, e)}
                                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Request
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : hasUpdateRequest ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-2"
                                onClick={(e) => handleDownload(doc, e)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        
                        {doc.requestFrequency ? (
                          <>
                            <div className="mt-1 flex items-center justify-center mb-3">
                              {doc.requestFrequency === 'monthly' ? (
                                <QuarterCarousel docId={doc.id} tone="orange" initialQuarter={getInitialQuarterForDoc(doc)} />
                              ) : (
                                <YearCarousel docId={doc.id} years={getYearsForDoc(doc)} tone="blue" />
                              )}
                            </div>
                          </>
                        ) : null}
                        
                        <div className="space-y-2">
                          <h4 className={`text-sm font-semibold line-clamp-2 ${
                            isRequested ? 'text-black' : 'text-black'
                          }`}>
                            {getDisplayName(doc)}
                          </h4>
                          
                          {isRequested ? (
                            <>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs bg-orange-100 border-orange-300 text-orange-700">
                                  Requested document
                                </Badge>
                                {doc.requestFrequency && (
                                  <Badge variant="secondary" className="text-xs bg-orange-200 text-orange-800">
                                    {doc.requestFrequency.charAt(0).toUpperCase() + doc.requestFrequency.slice(1)}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-orange-600">
                                Requested by {doc.requestedBy}
                              </p>
                              {doc.requestedAt && (
                                <p className="text-xs text-orange-500">
                                  {doc.requestedAt.toLocaleDateString()}
                                </p>
                              )}
                              {doc.description && (
                                <p className="text-xs text-gray-600 line-clamp-2 mt-2">
                                  {doc.description}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-gray-500">{doc.size}</p>
                              <p className="text-xs text-gray-500">{doc.uploadedAt.toLocaleDateString()}</p>
                              
                              <div className="space-y-1 pt-2">
                                <Badge variant="outline" className="text-xs bg-white border-gray-300 flex items-center gap-1">
                                  <Folder className="h-3 w-3" />
                                  {doc.folder}
                                </Badge>
                                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                  {doc.uploadedBy}
                                </Badge>
                                <Badge variant="outline" className="text-xs bg-orange-100 border-orange-300 text-orange-700">
                                  Update requested for {doc.requestedVersion} version
                                </Badge>
                              </div>

                              <div 
                                className="mt-2 p-3 bg-orange-50/50 rounded-lg border-2 border-dashed border-orange-300 hover:border-orange-400 hover:bg-orange-50/70 transition-all duration-200 cursor-pointer relative"
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.classList.add('border-orange-500', 'bg-orange-100/80');
                                }}
                                onDragLeave={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.classList.remove('border-orange-500', 'bg-orange-100/80');
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.classList.remove('border-orange-500', 'bg-orange-100/80');
                                  // Handle file upload here
                                  const files = Array.from(e.dataTransfer.files);
                                  if (files.length > 0) {
                                    console.log('Files dropped for update request:', files);
                                    // You can add actual upload logic here
                                  }
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Create a hidden file input and trigger it
                                  const input = document.createElement('input');
                                  input.type = 'file';
                                  input.multiple = true;
                                  input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png';
                                  input.onchange = (event) => {
                                    const files = Array.from((event.target as HTMLInputElement).files || []);
                                    if (files.length > 0) {
                                      console.log('Files selected for update request:', files);
                                      // You can add actual upload logic here
                                    }
                                  };
                                  input.click();
                                }}
                              >
                                <div className="text-center">
                                  <p className="text-xs text-orange-700 font-medium mb-1">Update Request</p>
                                  <p className="text-xs text-orange-600">
                                    Requested by {doc.updateRequestedBy}
                                  </p>
                                  {doc.updateRequestedAt && (
                                    <p className="text-xs text-orange-500 mb-2">
                                      {doc.updateRequestedAt.toLocaleDateString()}
                                    </p>
                                  )}
                                  {doc.updateRequestDescription && (
                                    <p className="text-xs text-gray-600 line-clamp-2 mb-3">
                                      {doc.updateRequestDescription}
                                    </p>
                                  )}
                                  <div className="border-t border-orange-200 pt-2 mt-2">
                                    <p className="text-xs text-orange-600 font-medium">📁 Drop files here or click to upload</p>
                                    <p className="text-xs text-orange-500 mt-1">Supports PDF, DOC, DOCX, JPG, PNG</p>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
    </div>;
};
export default DocumentLibrary;