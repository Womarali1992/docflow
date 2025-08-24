import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, ChevronDown, Calendar, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { RequestFrequency } from '@/types/dashboard';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';

interface DocumentsNeededProps {
  clientId: string;
  advisorName: string;
}

type BinItem = {
  id: string;
  name: string;
};

type Bin = {
  id: string;
  label: string;
  items: BinItem[];
  isDragOver?: boolean;
};

const DEFAULT_TYPES: string[] = [
  'Bank Statement',
  'Tax Return',
  'ID Copy',
  'Pay Stub',
  'Investment Statement',
  'Insurance Policy',
  'W-2',
  '1099',
  'Mortgage Statement',
  'Business Financials',
];

const getFrequencyIcon = (frequency: string) => {
  switch (frequency) {
    case 'monthly':
      return <Calendar className="h-4 w-4 text-blue-600" />;
    case 'quarterly':
      return <Clock className="h-4 w-4 text-purple-600" />;
    case 'yearly':
      return <Calendar className="h-4 w-4 text-green-600" />;
    default:
      return <AlertCircle className="h-4 w-4 text-orange-600" />;
  }
};

const getFrequencyColor = (frequency: string) => {
  switch (frequency) {
    case 'monthly':
      return 'bg-blue-50 border-blue-200 text-blue-800';
    case 'quarterly':
      return 'bg-purple-50 border-purple-200 text-purple-800';
    case 'yearly':
      return 'bg-green-50 border-green-200 text-green-800';
    default:
      return 'bg-orange-50 border-orange-200 text-orange-800';
  }
};

const inferFrequencyFromLabel = (label: string): RequestFrequency => {
  const l = label.toLowerCase();
  if (l.includes('month')) return 'monthly';
  if (l.includes('quarter')) return 'quarterly';
  if (l.includes('year')) return 'yearly';
  if (l.includes('one')) return 'one-time';
  return 'one-time';
};

const DocumentsNeeded = ({ clientId, advisorName }: DocumentsNeededProps) => {
  const { toast } = useToast();
  const { requestDocument } = useDocumentsStore();

  const [bins, setBins] = React.useState<Bin[]>([
    { id: 'bin-1', label: 'Monthly Documents', items: [] },
    { id: 'bin-2', label: 'Quarterly Documents', items: [] },
    { id: 'bin-3', label: 'Yearly Documents', items: [] },
    { id: 'bin-4', label: 'One-Time Documents', items: [] },
  ]);
  const { presets, applyPresetToClient } = useDocumentsStore();

  // Debug logging for collapsible state
  const [isOpen, setIsOpen] = React.useState(false);
  
  React.useEffect(() => {
    console.log('DocumentsNeeded collapsible state changed:', isOpen);
  }, [isOpen]);

  const handleDragStart = (e: React.DragEvent, typeName: string) => {
    e.dataTransfer.setData('text/plain', typeName);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const toggleDragOver = (binId: string, isOver: boolean) => {
    setBins(prev => prev.map(b => b.id === binId ? { ...b, isDragOver: isOver } : b));
  };

  const handleDrop = (e: React.DragEvent, binId: string) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/plain');
    if (!name) return;

    setBins(prev => prev.map(b => {
      if (b.id !== binId) return b;
      const exists = b.items.some(i => i.name.toLowerCase() === name.toLowerCase());
      if (exists) return { ...b, isDragOver: false };
      const newItem: BinItem = { id: `${binId}-${Date.now()}`, name };
      return { ...b, items: [...b.items, newItem], isDragOver: false };
    }));

    const bin = bins.find(b => b.id === binId);
    const frequency = inferFrequencyFromLabel(bin ? bin.label : '');

    // Create a requested document in global state
    requestDocument({
      documentName: name,
      requestedBy: advisorName,
      clientId,
      frequency,
    });

    toast({
      title: 'Document Requested',
      description: `${name} marked as needed (${frequency}).`,
    });
  };

  const handleRemove = (binId: string, itemId: string) => {
    setBins(prev => prev.map(b => b.id === binId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b));
  };

  const handleLabelChange = (binId: string, value: string) => {
    setBins(prev => prev.map(b => b.id === binId ? { ...b, label: value } : b));
  };

  const totalDocuments = bins.reduce((sum, bin) => sum + bin.items.length, 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-6 border-0 shadow-xl bg-gradient-to-br from-white to-slate-50/50">
        <CardHeader className="bg-gradient-to-r from-blue-50 via-blue-100 to-indigo-100 text-gray-800 border-0 rounded-t-lg">
          <CardTitle className="flex items-center gap-3 text-gray-800">
            <div className="p-2 bg-blue-200/50 rounded-lg">
              <div className="h-6 w-6 text-blue-700 text-center text-xl font-bold">+</div>
            </div>
            <div className="flex-1">
              <div className="text-xl font-semibold">Documents Needed</div>
              <div className="text-sm font-normal text-gray-600 mt-1">
                {totalDocuments} document{totalDocuments !== 1 ? 's' : ''} requested
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="ml-auto inline-flex items-center gap-2 text-gray-700 hover:bg-blue-200/50 hover:text-gray-800"
              >
                <span className="text-sm font-medium">{isOpen ? 'Hide Details' : 'Show Details'}</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        
        <CollapsibleContent asChild>
          <CardContent className="p-8 space-y-8">
            {/* Presets Section */}
            {presets.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">Quick Presets</h3>
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                    {presets.length} available
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-3">
                  {presets.map(preset => (
                    <Button
                      key={preset.id}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        applyPresetToClient(preset.id, { clientId, advisorName });
                        setBins(preset.bins.map(b => ({
                          id: b.id,
                          label: b.label,
                          items: b.items.map((i, idx) => ({ id: `${b.id}-${idx}-${Date.now()}`, name: i.name })),
                        })));
                        toast({ title: 'Preset Applied', description: `Preset "${preset.name}" applied successfully.` });
                      }}
                      className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200"
                    >
                      {preset.name}
                    </Button>
                  ))}
                </div>
                <Separator className="my-6" />
              </div>
            )}

            {/* Document Bins Grid */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Document Categories</h3>
                <div className="text-sm text-gray-500">
                  Drag document types to organize them by frequency
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {bins.map((bin) => {
                  const frequency = inferFrequencyFromLabel(bin.label);
                  const frequencyColor = getFrequencyColor(frequency);
                  
                  return (
                    <div
                      key={bin.id}
                      className={`group relative rounded-xl p-6 min-h-[160px] border-2 border-dashed transition-all duration-300 ${
                        bin.isDragOver 
                          ? 'border-blue-400 bg-blue-50/80 scale-105 shadow-lg' 
                          : 'border-blue-200 bg-gray-50/50 hover:border-blue-300 hover:bg-gray-50'
                      }`}
                      onDragOver={(e) => { e.preventDefault(); toggleDragOver(bin.id, true); }}
                      onDragLeave={() => toggleDragOver(bin.id, false)}
                      onDrop={(e) => handleDrop(e, bin.id)}
                    >
                      {/* Bin Header */}
                      <div className="flex items-center gap-2 mb-4">
                        <input
                          value={bin.label}
                          onChange={(e) => handleLabelChange(bin.id, e.target.value)}
                          placeholder="Category name"
                          className="flex-1 text-sm font-semibold text-gray-900 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 rounded px-2 py-1"
                        />
                      </div>

                      {/* Bin Content */}
                      <div className="space-y-3">
                        {bin.items.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-sm text-gray-500 font-medium">Drop documents here</p>
                            <p className="text-xs text-gray-400 mt-1">Drag from below</p>
                          </div>
                        ) : (
                          bin.items.map((item) => (
                            <div 
                              key={item.id} 
                              className="group/item flex items-center justify-between gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-all duration-200"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></div>
                                <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                              </div>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-gray-400 hover:text-red-600 opacity-0 group-hover/item:opacity-100 transition-opacity duration-200" 
                                onClick={() => handleRemove(bin.id, item.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Bin Footer */}
                      <div className="absolute bottom-3 left-3 right-3">
                        <div className="text-xs text-gray-400 text-center">
                          {bin.items.length} document{bin.items.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Available Document Types */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="text-lg font-semibold text-gray-900">Available Document Types</h4>
                <Badge variant="outline" className="text-gray-600">
                  {DEFAULT_TYPES.length} types
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3">
                {DEFAULT_TYPES.map(type => (
                  <div
                    key={type}
                    draggable
                    onDragStart={(e) => handleDragStart(e, type)}
                    className="group px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white cursor-grab active:cursor-grabbing hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 hover:scale-105"
                    title="Drag to a category"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors text-center text-sm font-bold">+</div>
                      {type}
                    </div>
                  </div>
                ))}
              </div>
            </div>


          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default DocumentsNeeded;


