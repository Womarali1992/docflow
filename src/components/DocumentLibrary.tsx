import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreVertical, Trash2, ArrowLeft, ArrowRight, ChevronRight, ChevronLeft } from 'lucide-react';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { RequestFrequency } from '@/types/dashboard';
import { FileText, Download, Search, Folder } from 'lucide-react';
import { Document } from '@/types/dashboard';
import { groupDocumentsByBaseNameMap } from '@/utils/documentGrouping';
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
          <ChevronLeft className="h-4 w-4 text-blue-600" />
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
  const QuarterCarousel = ({ docId, tone, initialQuarter = 'Q1', showQuarterLabel = true, showYearInCenter = false }: { docId: string; tone: 'orange' | 'blue'; initialQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4'; showQuarterLabel?: boolean; showYearInCenter?: boolean }) => {
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
      
      if (showYearInCenter) {
        const doc = getDocumentById(docId);
        const currentYear = selectedYearByDoc[docId] || getYearsForDoc(doc)[getYearsForDoc(doc).length - 1];
        
        if (currentIndex <= 0) {
          // At Q1, go to Q4 of previous year
          const newYear = currentYear - 1;
          setSelectedYearByDoc(prev => ({ ...prev, [docId]: newYear }));
          setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: 'Q4' }));
          
          if (doc?.requestFrequency === 'monthly') {
            const months = getMonthsForQuarter('Q4');
            setSelectedPeriodByDoc(prev => ({ ...prev, [docId]: months[0] }));
          }
        } else {
          // Normal navigation within same year
          const nextIdx = currentIndex - 1;
          const newQuarter = quarters[nextIdx];
          setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: newQuarter }));
          
          if (doc?.requestFrequency === 'monthly') {
            const months = getMonthsForQuarter(newQuarter);
            setSelectedPeriodByDoc(prev => ({ ...prev, [docId]: months[0] }));
          }
        }
      } else {
        // Original behavior for desktop
        const nextIdx = Math.max(0, currentIndex - 1);
        setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: quarters[nextIdx] }));
      }
    };
    
    const goNext = (e: React.MouseEvent) => {
      e.stopPropagation();
      
      if (showYearInCenter) {
        const doc = getDocumentById(docId);
        const currentYear = selectedYearByDoc[docId] || getYearsForDoc(doc)[getYearsForDoc(doc).length - 1];
        
        if (currentIndex >= quarters.length - 1) {
          // At Q4, go to Q1 of next year
          const newYear = currentYear + 1;
          setSelectedYearByDoc(prev => ({ ...prev, [docId]: newYear }));
          setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: 'Q1' }));
          
          if (doc?.requestFrequency === 'monthly') {
            const months = getMonthsForQuarter('Q1');
            setSelectedPeriodByDoc(prev => ({ ...prev, [docId]: months[0] }));
          }
        } else {
          // Normal navigation within same year
          const nextIdx = currentIndex + 1;
          const newQuarter = quarters[nextIdx];
          setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: newQuarter }));
          
          if (doc?.requestFrequency === 'monthly') {
            const months = getMonthsForQuarter(newQuarter);
            setSelectedPeriodByDoc(prev => ({ ...prev, [docId]: months[0] }));
          }
        }
      } else {
        // Original behavior for desktop
        const nextIdx = Math.min(quarters.length - 1, currentIndex + 1);
        setSelectedQuarterByDoc(prev => ({ ...prev, [docId]: quarters[nextIdx] }));
      }
    };

    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goPrev}
          disabled={!showYearInCenter && currentIndex <= 0}
        >
          <ChevronLeft className="h-4 w-4 text-blue-600" />
        </Button>
        {showQuarterLabel && (
          <div className={`px-3 py-1 rounded-full text-sm ${badgeBase}`}>
            {(() => {
              const doc = getDocumentById(docId);
              const year = selectedYearByDoc[docId] || getDocumentYear(doc);
              return getQuarterWithYear(quarters[currentIndex], year);
            })()}
          </div>
        )}
        {showYearInCenter && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="outline" size="sm" className={tone === 'orange' ? 'border-orange-300 text-orange-700 hover:bg-orange-50' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}>
                {selectedYearByDoc[docId] || getYearsForDoc(getDocumentById(docId))[getYearsForDoc(getDocumentById(docId)).length - 1]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {getYearsForDoc(getDocumentById(docId)).map((year) => (
                <DropdownMenuItem
                  key={year}
                  onClick={(e) => { e.stopPropagation(); setSelectedYearByDoc(prev => ({ ...prev, [docId]: year })); }}
                >
                  {year}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full ${arrowClass}`}
          onClick={goNext}
          disabled={!showYearInCenter && currentIndex >= quarters.length - 1}
        >
          <ChevronRight className="h-4 w-4 text-blue-600" />
        </Button>
      </div>
    );
  };

  const getInitialQuarterForDoc = (doc: Document): 'Q1' | 'Q2' | 'Q3' | 'Q4' => {
    const month = doc.uploadedAt.getMonth(); // 0-11
    const qIndex = Math.floor(month / 3); // 0-3
    return (['Q1', 'Q2', 'Q3', 'Q4'] as const)[qIndex];
  };

  const getDocumentById = (docId: string): Document => {
    return documents.find(doc => doc.id === docId) || documents[0];
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

  // Helper function to get month name with year for display
  const getMonthWithYear = (month: string, year: number): string => {
    return `${month} ${year}`;
  };

  // Helper function to get quarter with year for display
  const getQuarterWithYear = (quarter: string, year: number): string => {
    return `${quarter} ${year}`;
  };

  // Helper function to get the year for a document
  const getDocumentYear = (doc: Document): number => {
    return doc.uploadedAt.getFullYear();
  };

  // Helper function to check if a time period matches the document
  const isTimePeriodForDocument = (doc: Document, period: string, periodType: 'month' | 'quarter'): boolean => {
    const docYear = getDocumentYear(doc);
    const docMonth = doc.uploadedAt.getMonth();
    
    if (periodType === 'month') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = monthNames.indexOf(period);
      return monthIndex === docMonth && docYear === (selectedYearByDoc[doc.id] || docYear);
    } else {
      const quarter = Math.floor(docMonth / 3) + 1;
      const docQuarter = `Q${quarter}`;
      return period === docQuarter && docYear === (selectedYearByDoc[doc.id] || docYear);
    }
  };

  // Helper function to format date as "Month Year"
  const formatDateAsMonthYear = (date: Date): string => {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${month} ${year}`;
  };

  // Helper function to navigate to document's time period
  const navigateToDocumentTimePeriod = (targetDoc: Document, parentDoc?: Document) => {
    const docYear = getDocumentYear(targetDoc);
    const docMonth = targetDoc.uploadedAt.getMonth();
    const docQuarter = Math.floor(docMonth / 3) + 1;
    
    // Set the year and quarter/period to match the document
    setSelectedYearByDoc(prev => ({ ...prev, [targetDoc.id]: docYear }));
    setSelectedQuarterByDoc(prev => ({ ...prev, [targetDoc.id]: `Q${docQuarter}` as const }));
    
    if (targetDoc.requestFrequency === 'monthly') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      setSelectedPeriodByDoc(prev => ({ ...prev, [targetDoc.id]: monthNames[docMonth] }));
    }
    
    // Also update the parent document's time period if it has request frequency
    if (parentDoc?.requestFrequency) {
      setSelectedYearByDoc(prev => ({ ...prev, [parentDoc.id]: docYear }));
      setSelectedQuarterByDoc(prev => ({ ...prev, [parentDoc.id]: `Q${docQuarter}` as const }));
      
      if (parentDoc.requestFrequency === 'monthly') {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        setSelectedPeriodByDoc(prev => ({ ...prev, [parentDoc.id]: monthNames[docMonth] }));
      }
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

  // Group documents by base document type (excluding time period)
  const groupedDocuments = React.useMemo(() => {
    return groupDocumentsByBaseNameMap(filteredDocuments);
  }, [filteredDocuments]);

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
      // For mock documents, show a message instead of trying to download
      if (doc.url.startsWith('#')) {
        alert('This is a mock document for demonstration purposes. In a real application, this would download the actual file.');
        return;
      }
      
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
        // Convert grouped documents back to arrays but keep grouping info
        const allGroupedDocs = Array.from(groupedDocuments.entries()).map(([baseName, docs]) => ({
          baseName,
          docs: docs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()) // Sort by newest first
        }));
        
        const uploadedGroups = allGroupedDocs.map(group => ({
          ...group,
          docs: group.docs.filter(doc => !(doc.isRequested && !doc.url) && !(doc.hasUpdateRequest && doc.url))
        })).filter(group => group.docs.length > 0);
        
        const requestedGroups = allGroupedDocs.map(group => ({
          ...group,
          docs: group.docs.filter(doc => (doc.isRequested && !doc.url) || (doc.hasUpdateRequest && doc.url))
        })).filter(group => group.docs.length > 0);
        
        return (
          <div className="space-y-6">


            {/* Uploaded Documents - 2 columns even on mobile */}
            {uploadedGroups.length > 0 && (
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-4">Uploaded Documents</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {uploadedGroups.map(group => {
                    // Use the first document as the representative for display
                    const doc = group.docs[0];
                    const docCount = group.docs.length;
                    return (
                      <div 
                        key={group.baseName} 
                        className="p-3 rounded-xl transition-all duration-200 cursor-pointer border border-gray-200 bg-gray-50 hover:bg-white hover:shadow-md"
                        onClick={() => {
                          // Auto-navigate to the document's time period
                          const docYear = getDocumentYear(doc);
                          const docMonth = doc.uploadedAt.getMonth();
                          const docQuarter = Math.floor(docMonth / 3) + 1;
                          
                          // Set the year and quarter/period to match the document
                          setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                          setSelectedQuarterByDoc(prev => ({ ...prev, [doc.id]: `Q${docQuarter}` as const }));
                          
                          if (doc.requestFrequency === 'monthly') {
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: monthNames[docMonth] }));
                          }
                          
                          onSelectDocument && onSelectDocument(doc);
                        }}
                      >
                                                 <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 mb-2">
                           <div className="w-10 h-10 rounded-lg shadow-sm flex items-center justify-center bg-white">
                            <FileText className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            {doc.requestFrequency && (
                              <div className="flex items-center justify-center gap-0.5">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button 
                                      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent cursor-pointer bg-blue-100 text-blue-800 hover:bg-blue-200"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {doc.requestFrequency === 'monthly' 
                                        ? (() => {
                                            const month = selectedPeriodByDoc[doc.id] || getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc))[0];
                                            const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                            return getMonthWithYear(month, year);
                                          })()
                                        : (() => {
                                            const quarter = selectedQuarterByDoc[doc.id] || getInitialQuarterForDoc(doc);
                                            const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                            return getQuarterWithYear(quarter, year);
                                          })()
                                      }
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                                    {doc.requestFrequency === 'monthly' ? (
                                                                             getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc)).map((m) => {
                                         const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                         const isCurrentDocPeriod = isTimePeriodForDocument(doc, m, 'month');
                                         return (
                                           <DropdownMenuItem
                                             key={m}
                                             onClick={(e) => { 
                                               e.stopPropagation(); 
                                               setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: m })); 
                                               
                                               // Also update the year to match the selected month
                                               // When user clicks on a month, we need to determine which year it should be
                                               const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                               const monthIndex = monthNames.indexOf(m);
                                               if (monthIndex !== -1) {
                                                 // For now, let's use the document's year as the base
                                                 // In a real app, you might want to show a year picker or use the current selected year
                                                 const docYear = getDocumentYear(doc);
                                                 setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                                               }
                                             }}
                                             className={isCurrentDocPeriod ? 'bg-blue-50 text-blue-700 font-medium' : ''}
                                           >
                                             <div className="flex items-center justify-between w-full">
                                               <span>{getMonthWithYear(m, year)}</span>
                                               {isCurrentDocPeriod && (
                                                 <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                                                   Current
                                                 </span>
                                               )}
                                             </div>
                                           </DropdownMenuItem>
                                         );
                                       })
                                    ) : (
                                                                             ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => {
                                         const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                         const isCurrentDocPeriod = isTimePeriodForDocument(doc, q, 'quarter');
                                         return (
                                           <DropdownMenuItem
                                             key={q}
                                             onClick={(e) => { 
                                               e.stopPropagation(); 
                                               setSelectedQuarterByDoc(prev => ({ ...prev, [doc.id]: q })); 
                                               
                                               // Also update the year to match the selected quarter
                                               // When user clicks on a quarter, we need to determine which year it should be
                                               const docYear = getDocumentYear(doc);
                                               setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                                               
                                               // If monthly frequency, also set the first month of the selected quarter
                                               if (doc.requestFrequency === 'monthly') {
                                                 const months = getMonthsForQuarter(q);
                                                 setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: months[0] }));
                                               }
                                             }}
                                             className={isCurrentDocPeriod ? 'bg-blue-50 text-blue-700 font-medium' : ''}
                                           >
                                             <div className="flex items-center justify-between w-full">
                                               <span>{getQuarterWithYear(q, year)}</span>
                                               {isCurrentDocPeriod && (
                                                 <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                                                   Current
                                                 </span>
                                               )}
                                             </div>
                                           </DropdownMenuItem>
                                         );
                                       })
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                {doc.requestFrequency === 'monthly' && (
                                  <button 
                                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-blue-50 text-blue-700 border-blue-200"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {(() => {
                                      const quarter = selectedQuarterByDoc[doc.id] || getInitialQuarterForDoc(doc);
                                      const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                      return getQuarterWithYear(quarter, year);
                                    })()}
                                  </button>
                                )}
                              </div>
                            )}
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
                            {/* Mobile: Show year between arrow buttons */}
                            <div className="mt-1 flex items-center justify-center mb-3 md:hidden">
                              <QuarterCarousel docId={doc.id} tone="blue" initialQuarter={getInitialQuarterForDoc(doc)} showQuarterLabel={false} showYearInCenter={true} />
                            </div>
                            
                            {/* Desktop: Show original logic */}
                            <div className="mt-1 hidden md:flex items-center justify-center mb-3">
                              {doc.requestFrequency === 'monthly' ? (
                                <QuarterCarousel docId={doc.id} tone="blue" initialQuarter={getInitialQuarterForDoc(doc)} />
                              ) : (
                                <YearCarousel docId={doc.id} years={getYearsForDoc(doc)} tone="blue" />
                              )}
                            </div>
                          </>
                        ) : null}
                        
                                                 <div className="space-y-1.5">
                           <div className="text-center">
                             <h4 className="text-sm font-semibold line-clamp-2 text-gray-800">
                              {docCount > 1 ? group.baseName : getDisplayName(doc)}
                            </h4>
                                                         {docCount > 1 && (
                               <DropdownMenu>
                                 <DropdownMenuTrigger asChild>
                                   <button className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-100 mt-1">
                                     {docCount} documents
                                   </button>
                                 </DropdownMenuTrigger>
                                 <DropdownMenuContent align="center" className="w-48">
                                   <DropdownMenuItem className="text-xs font-medium text-gray-700 cursor-default">
                                     Available dates:
                                   </DropdownMenuItem>
                                   <DropdownMenuSeparator />
                                   {group.docs.map((docItem, index) => (
                                     <DropdownMenuItem 
                                       key={index}
                                       className="text-xs text-gray-600 cursor-pointer"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         
                                         // Navigate to the document's time period
                                         navigateToDocumentTimePeriod(docItem, doc);
                                         
                                         onSelectDocument && onSelectDocument(docItem);
                                       }}
                                     >
                                       <div className="flex items-center justify-between w-full">
                                         <span className="truncate">
                                           {docItem.name}
                                         </span>
                                         <span className="text-gray-500 ml-2">
                                           {formatDateAsMonthYear(docItem.uploadedAt)}
                                         </span>
                                       </div>
                                     </DropdownMenuItem>
                                   ))}
                                 </DropdownMenuContent>
                               </DropdownMenu>
                             )}
                          </div>
                          
                                                     <div className="flex items-center justify-center gap-4 text-center">
                             <p className="text-xs text-gray-500">{formatDateAsMonthYear(doc.uploadedAt)}</p>
                             <p className="text-xs text-gray-500">{doc.size}</p>
                           </div>
                           
                           {/* Card Footer */}
                           <div className="mt-3 pt-3 border-t border-gray-100">
                             <div className="flex items-center justify-center gap-1.5">
                               <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                 {doc.uploadedBy}
                               </Badge>
                               <Badge variant="outline" className="text-xs bg-white border-gray-300 flex items-center gap-1">
                                 <Folder className="h-3 w-3" />
                                 {doc.folder}
                               </Badge>
                             </div>
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Requested Documents - 1 column (includes both requested and update requests) */}
            {requestedGroups.length > 0 && (
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-4">Requested Documents</h4>
                <div className="grid grid-cols-1 gap-4">
                  {requestedGroups.map(group => {
                    // Use the first document as the representative for display
                    const doc = group.docs[0];
                    const docCount = group.docs.length;
                    const isRequested = doc.isRequested && !doc.url;
                    const hasUpdateRequest = doc.hasUpdateRequest && doc.url;
                    
                    return (
                      <div 
                        key={group.baseName} 
                        className={`p-4 rounded-xl transition-all duration-200 cursor-pointer ${
                          isRequested 
                            ? 'border-2 border-dashed border-orange-300 bg-orange-50/30 hover:bg-orange-50/50'
                            : 'border border-gray-200 bg-gray-50 hover:bg-white hover:shadow-md'
                        }`}
                        onClick={() => {
                          // Auto-navigate to the document's time period
                          const docYear = getDocumentYear(doc);
                          const docMonth = doc.uploadedAt.getMonth();
                          const docQuarter = Math.floor(docMonth / 3) + 1;
                          
                          // Set the year and quarter/period to match the document
                          setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                          setSelectedQuarterByDoc(prev => ({ ...prev, [doc.id]: `Q${docQuarter}` as const }));
                          
                          if (doc.requestFrequency === 'monthly') {
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: monthNames[docMonth] }));
                          }
                          
                          onSelectDocument && onSelectDocument(doc);
                        }}
                      >
                                                 <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 mb-2">
                           <div className={`w-10 h-10 rounded-lg shadow-sm flex items-center justify-center ${
                            isRequested ? 'bg-orange-100' : 'bg-white'
                          }`}>
                            <FileText className={`h-5 w-5 ${isRequested ? 'text-orange-600' : 'text-blue-600'}`} />
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            {doc.requestFrequency && (
                              <div className="flex items-center justify-center gap-0.5">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button 
                                      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent cursor-pointer bg-orange-100 text-orange-800 hover:bg-orange-200"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {doc.requestFrequency === 'monthly' 
                                        ? (() => {
                                            const month = selectedPeriodByDoc[doc.id] || getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc))[0];
                                            const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                            return getMonthWithYear(month, year);
                                          })()
                                        : (() => {
                                            const quarter = selectedQuarterByDoc[doc.id] || getInitialQuarterForDoc(doc);
                                            const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                            return getQuarterWithYear(quarter, year);
                                          })()
                                      }
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                                    {doc.requestFrequency === 'monthly' ? (
                                                                             getMonthsForQuarter(selectedQuarterByDoc[doc.id] ?? getInitialQuarterForDoc(doc)).map((m) => {
                                         const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                         const isCurrentDocPeriod = isTimePeriodForDocument(doc, m, 'month');
                                         return (
                                           <DropdownMenuItem
                                             key={m}
                                             onClick={(e) => { 
                                               e.stopPropagation(); 
                                               setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: m })); 
                                               
                                               // Also update the year to match the selected month
                                               // When user clicks on a month, we need to determine which year it should be
                                               const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                               const monthIndex = monthNames.indexOf(m);
                                               if (monthIndex !== -1) {
                                                 // For now, let's use the document's year as the base
                                                 // In a real app, you might want to show a year picker or use the current selected year
                                                 const docYear = getDocumentYear(doc);
                                                 setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                                               }
                                             }}
                                             className={isCurrentDocPeriod ? 'bg-orange-50 text-orange-700 font-medium' : ''}
                                           >
                                             <div className="flex items-center justify-between w-full">
                                               <span>{getMonthWithYear(m, year)}</span>
                                               {isCurrentDocPeriod && (
                                                 <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded-full">
                                                   Current
                                                 </span>
                                               )}
                                             </div>
                                           </DropdownMenuItem>
                                         );
                                       })
                                    ) : (
                                                                             ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => {
                                         const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                         const isCurrentDocPeriod = isTimePeriodForDocument(doc, q, 'quarter');
                                         return (
                                           <DropdownMenuItem
                                             key={q}
                                             onClick={(e) => { 
                                               e.stopPropagation(); 
                                               setSelectedQuarterByDoc(prev => ({ ...prev, [doc.id]: q })); 
                                               
                                               // Also update the year to match the selected quarter
                                               // When user clicks on a quarter, we need to determine which year it should be
                                               const docYear = getDocumentYear(doc);
                                               setSelectedYearByDoc(prev => ({ ...prev, [doc.id]: docYear }));
                                               
                                               // If monthly frequency, also set the first month of the selected quarter
                                               if (doc.requestFrequency === 'monthly') {
                                                 const months = getMonthsForQuarter(q);
                                                 setSelectedPeriodByDoc(prev => ({ ...prev, [doc.id]: months[0] }));
                                               }
                                             }}
                                             className={isCurrentDocPeriod ? 'bg-orange-50 text-orange-700 font-medium' : ''}
                                           >
                                             <div className="flex items-center justify-between w-full">
                                               <span>{getQuarterWithYear(q, year)}</span>
                                               {isCurrentDocPeriod && (
                                                 <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded-full">
                                                   Current
                                                 </span>
                                               )}
                                             </div>
                                           </DropdownMenuItem>
                                         );
                                       })
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                {doc.requestFrequency === 'monthly' && (
                                  <button 
                                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-orange-50 text-orange-700 border-orange-200"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {(() => {
                                      const quarter = selectedQuarterByDoc[doc.id] || getInitialQuarterForDoc(doc);
                                      const year = selectedYearByDoc[doc.id] || getDocumentYear(doc);
                                      return getQuarterWithYear(quarter, year);
                                    })()}
                                  </button>
                                )}
                              </div>
                            )}
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
                            {/* Mobile: Show year between arrow buttons */}
                            <div className="mt-1 flex items-center justify-center mb-3 md:hidden">
                              <QuarterCarousel docId={doc.id} tone="orange" initialQuarter={getInitialQuarterForDoc(doc)} showQuarterLabel={false} showYearInCenter={true} />
                            </div>
                            
                            {/* Desktop: Show original logic */}
                            <div className="mt-1 hidden md:flex items-center justify-center mb-3">
                              {doc.requestFrequency === 'monthly' ? (
                                <QuarterCarousel docId={doc.id} tone="orange" initialQuarter={getInitialQuarterForDoc(doc)} />
                              ) : (
                                <YearCarousel docId={doc.id} years={getYearsForDoc(doc)} tone="orange" />
                              )}
                            </div>
                          </>
                        ) : null}
                        
                                                 <div className="space-y-1.5">
                           <div className="text-center">
                             <h4 className={`text-sm font-semibold line-clamp-2 ${
                              isRequested ? 'text-black' : 'text-black'
                            }`}>
                              {docCount > 1 ? group.baseName : getDisplayName(doc)}
                            </h4>
                                                         {docCount > 1 && (
                               <DropdownMenu>
                                 <DropdownMenuTrigger asChild>
                                   <button className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent cursor-pointer bg-orange-50 text-orange-600 hover:bg-orange-100 mt-1">
                                     {docCount} documents
                                   </button>
                                 </DropdownMenuTrigger>
                                 <DropdownMenuContent align="center" className="w-48">
                                   <DropdownMenuItem className="text-xs font-medium text-gray-700 cursor-default">
                                     Available dates:
                                   </DropdownMenuItem>
                                   <DropdownMenuSeparator />
                                   {group.docs.map((docItem, index) => (
                                     <DropdownMenuItem 
                                       key={index}
                                       className="text-xs text-gray-600 cursor-pointer"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         
                                         // Navigate to the document's time period
                                         navigateToDocumentTimePeriod(docItem, doc);
                                         
                                         onSelectDocument && onSelectDocument(docItem);
                                       }}
                                     >
                                       <div className="flex items-center justify-between w-full">
                                         <span className="truncate">
                                           {docItem.name}
                                         </span>
                                         <span className="text-gray-500 ml-2">
                                           {formatDateAsMonthYear(docItem.uploadedAt)}
                                         </span>
                                       </div>
                                     </DropdownMenuItem>
                                   ))}
                                 </DropdownMenuContent>
                               </DropdownMenu>
                             )}
                          </div>
                          
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
                                  {formatDateAsMonthYear(doc.requestedAt)}
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
                                                             <div className="flex items-center justify-center gap-4 text-center">
                                 <p className="text-xs text-gray-500">{formatDateAsMonthYear(doc.uploadedAt)}</p>
                                 <p className="text-xs text-gray-500">{doc.size}</p>
                               </div>
                               
                               {/* Card Footer */}
                               <div className="mt-3 pt-3 border-t border-gray-100">
                                 <div className="space-y-2">
                                   <div className="flex items-center justify-center gap-2 flex-wrap">
                                     <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                       {doc.uploadedBy}
                                     </Badge>
                                     <Badge variant="outline" className="text-xs bg-white border-gray-300 flex items-center gap-1">
                                       <Folder className="h-3 w-3" />
                                       {doc.folder}
                                     </Badge>
                                   </div>
                                   <div className="text-center">
                                     <Badge variant="outline" className="text-xs bg-orange-100 border-orange-300 text-orange-700">
                                       Update requested for {doc.requestedVersion} version
                                     </Badge>
                                   </div>
                                 </div>
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
                                      {formatDateAsMonthYear(doc.updateRequestedAt)}
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