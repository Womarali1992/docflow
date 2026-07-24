import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, FileText, Trash2 } from 'lucide-react';
import { Document, RequestFrequency } from '@/types/dashboard';
import { getDocumentStats } from '@/utils/documentUtils';
import { groupDocumentsByBaseName } from '@/utils/documentGrouping';

interface RequestedDocumentsSectionProps {
  documents: Document[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isSelectionModeActive: boolean;
  selectedTimePeriods: Set<string>;
  onToggleSelectionMode: () => void;
  onUpdateFrequency: (documentId: string, frequency: RequestFrequency) => void;
  onDeleteDocument: (document: Document) => void;
  onTimePeriodToggle: (timePeriodId: string) => void;
  onSelectAllTimePeriods: (timePeriods: Document[]) => void;
  onDeselectAllTimePeriods: () => void;
  onBulkDeleteTimePeriods: (documentId: string, timePeriods: Document[]) => void;
}

const RequestedDocumentsSection: React.FC<RequestedDocumentsSectionProps> = ({
  documents,
  isOpen,
  onOpenChange,
  isSelectionModeActive,
  selectedTimePeriods,
  onToggleSelectionMode,
  onUpdateFrequency,
  onDeleteDocument,
  onTimePeriodToggle,
  onSelectAllTimePeriods,
  onDeselectAllTimePeriods,
  onBulkDeleteTimePeriods,
}) => {
  // Group documents by base document type (excluding time period)
  const groupedDocs = groupDocumentsByBaseName(
    documents.filter(d => d.isRequested)
  );

  return (
    <div className="space-y-4">
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            className="w-full justify-between p-0 h-auto hover:bg-transparent"
          >
            <h3 className="text-lg font-semibold text-gray-900">Requested Documents</h3>
            <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="space-y-4 mt-4">
          {Object.entries(groupedDocs).map(([docName, docs]) => {
            const firstDoc = docs[0];
            const stats = getDocumentStats(docs);
            
            return (
              <div key={docName} className="p-4 border rounded-lg bg-orange-50/40 border-orange-200">
                {/* Document Type Header */}
                <div className="mb-3 pb-2 border-b border-orange-200">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-orange-700 uppercase tracking-wide">
                      {firstDoc.requestFrequency ? firstDoc.requestFrequency.charAt(0).toUpperCase() + firstDoc.requestFrequency.slice(1) : 'One-time'} Request
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge className={`${stats.received > 0 ? 'bg-blue-200 text-blue-800' : 'bg-orange-200 text-orange-800'}`}>
                        {stats.received > 0 ? `Received ${stats.received}/${stats.total}` : `Pending ${stats.total}`}
                      </Badge>
                    </div>
                  </div>
                </div>
                
                {/* Document Name and Description */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileText className="h-5 w-5 text-orange-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <h4 className="font-medium text-orange-900 truncate">{docName}</h4>
                      {firstDoc.description && (
                        <p className="text-sm text-orange-800">{firstDoc.description}</p>
                      )}
                    </div>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">⋮</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onUpdateFrequency(firstDoc.id, 'monthly')}>Monthly</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onUpdateFrequency(firstDoc.id, 'quarterly')}>Quarterly</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onUpdateFrequency(firstDoc.id, 'yearly')}>Yearly</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onToggleSelectionMode}>
                        {isSelectionModeActive ? (
                          <>
                            <Trash2 className="h-4 w-4 mr-2 text-blue-600" />
                            Exit Selection Mode
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Enable Multi-Select
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => onDeleteDocument(firstDoc)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Request
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Time Periods Grid */}
                <div className="space-y-3">
                  {/* Selection Mode Indicator */}
                  {isSelectionModeActive && (
                    <div className="text-xs text-blue-600 px-2 py-1 bg-blue-50 border border-blue-200 rounded">
                      🎯 Selection Mode Active - Click on time periods to select them
                    </div>
                  )}
                  
                  {/* Bulk Actions Header */}
                  {isSelectionModeActive && docs.length > 0 && (
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTimePeriods.size === docs.length && docs.length > 0}
                          onChange={() => {
                            if (selectedTimePeriods.size === docs.length) {
                              onDeselectAllTimePeriods();
                            } else {
                              onSelectAllTimePeriods(docs);
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-xs text-gray-600">
                          {selectedTimePeriods.size} of {docs.length} selected
                        </span>
                      </div>
                      {selectedTimePeriods.size > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onBulkDeleteTimePeriods(firstDoc.id, docs)}
                          className="text-xs h-6 px-2 animate-pulse"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete Selected ({selectedTimePeriods.size})
                        </Button>
                      )}
                    </div>
                  )}
                  
                  {/* Time Periods Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {docs.map((doc) => {
                      const isReceived = !!doc.url;
                      const periodLabel = doc.requestedVersion || 
                        (doc.requestedAt ? doc.requestedAt.toLocaleDateString() : 'Unknown');
                      const isSelected = selectedTimePeriods.has(doc.id);
                      
                      return (
                        <div 
                          key={doc.id} 
                          className={`flex items-center justify-between p-2 rounded border text-xs transition-all ${
                            isSelectionModeActive 
                              ? `cursor-pointer ${
                                  isSelected 
                                    ? 'border-blue-500 bg-blue-50 shadow-sm' 
                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                }`
                              : 'border-gray-200'
                          }`}
                          onClick={isSelectionModeActive ? () => onTimePeriodToggle(doc.id) : undefined}
                        >
                          <div className="flex items-center gap-2">
                            {isSelectionModeActive && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => onTimePeriodToggle(doc.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded border-gray-300"
                              />
                            )}
                            <span className={`font-medium ${
                              isReceived 
                                ? 'text-blue-600' 
                                : 'text-orange-600'
                            }`}>{periodLabel}</span>
                          </div>
                          <Badge 
                            className={`ml-2 ${
                              isReceived 
                                ? 'bg-blue-100 text-blue-700 border-blue-300' 
                                : 'bg-orange-100 text-orange-700 border-orange-300'
                            }`}
                          >
                            {isReceived ? 'Received' : 'Pending'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Request Info */}
                <div className="mt-3 pt-2 border-t border-orange-200">
                  <p className="text-xs text-orange-700">
                    Requested by {firstDoc.requestedBy} • Last updated {firstDoc.requestedAt?.toLocaleDateString()}
                  </p>
                </div>
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default RequestedDocumentsSection;
