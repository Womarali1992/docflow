import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, FilePlus2, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { RequestFrequency } from '@/types/dashboard';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
    { id: 'bin-1', label: 'Monthly Docs', items: [] },
    { id: 'bin-2', label: 'Quarterly Docs', items: [] },
    { id: 'bin-3', label: 'Yearly Docs', items: [] },
    { id: 'bin-4', label: 'One-Time', items: [] },
  ]);
  const { presets, applyPresetToClient } = useDocumentsStore();

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

  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-6 border-blue-200 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-indigo-100 to-indigo-50 border-b border-blue-200">
          <CardTitle className="flex items-center gap-2 text-blue-900">
            <FilePlus2 className="h-5 w-5" />
            Documents Needed
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto inline-flex items-center gap-1 text-blue-900">
                <span className="text-sm">{isOpen ? 'Hide' : 'Show'}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="p-6">
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {presets.map(preset => (
              <span
                key={preset.id}
                onClick={() => {
                  applyPresetToClient(preset.id, { clientId, advisorName });
                  setBins(preset.bins.map(b => ({
                    id: b.id,
                    label: b.label,
                    items: b.items.map((i, idx) => ({ id: `${b.id}-${idx}-${Date.now()}`, name: i.name })),
                  })));
                  toast({ title: 'Preset Applied', description: `Preset "${preset.name}" applied.` });
                }}
                className="px-3 py-1.5 text-sm rounded-full border border-blue-200 bg-white text-blue-700 cursor-pointer hover:bg-blue-50"
                title="Apply preset"
              >
                {preset.name}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {bins.map((bin) => (
            <div
              key={bin.id}
              className={`rounded-lg p-3 min-h-[120px] border-2 border-dashed transition-colors bg-indigo-50/20 ${
                bin.isDragOver ? 'border-indigo-400 bg-indigo-50/60' : 'border-indigo-300'
              }`}
              onDragOver={(e) => { e.preventDefault(); toggleDragOver(bin.id, true); }}
              onDragLeave={() => toggleDragOver(bin.id, false)}
              onDrop={(e) => handleDrop(e, bin.id)}
            >
              <input
                value={bin.label}
                onChange={(e) => handleLabelChange(bin.id, e.target.value)}
                placeholder="Custom label"
                className="w-full mb-2 text-sm font-medium text-blue-900 bg-transparent focus:outline-none"
              />
              <div className="space-y-2">
                {bin.items.length === 0 ? (
                  <p className="text-xs text-gray-500">Drag document types here</p>
                ) : (
                  bin.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 p-2 bg-white border border-indigo-100 rounded-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-gray-800 truncate">{item.name}</span>
                        <Badge className="text-xs bg-orange-200 text-orange-800">Requested</Badge>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-500 hover:text-red-600" onClick={() => handleRemove(bin.id, item.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Available document types</h4>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_TYPES.map(type => (
              <div
                key={type}
                draggable
                onDragStart={(e) => handleDragStart(e, type)}
                className="px-3 py-1.5 text-sm rounded-full border border-gray-300 bg-white cursor-grab active:cursor-grabbing hover:bg-gray-50"
                title="Drag to a bin"
              >
                {type}
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


