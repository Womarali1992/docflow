import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, FileText, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { RequestFrequency } from '@/types/dashboard';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface PreparedMaterialsProps {
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

const DEFAULT_MATERIAL_TYPES: string[] = [
  'Financial Plan',
  'Portfolio Review',
  'Tax Summary',
  'Budget Analysis',
  'Retirement Projection',
  'Investment Report',
  'Insurance Review',
  'Net Worth Statement',
  'Cash Flow Report',
  'Performance Summary',
];

const inferFrequencyFromLabel = (label: string): RequestFrequency => {
  const l = label.toLowerCase();
  if (l.includes('month')) return 'monthly';
  if (l.includes('quarter')) return 'quarterly';
  if (l.includes('year')) return 'yearly';
  if (l.includes('one')) return 'one-time';
  return 'one-time';
};

const PreparedMaterials = ({ clientId, advisorName }: PreparedMaterialsProps) => {
  const { toast } = useToast();
  const { setDocuments } = useDocumentsStore();

  const [bins, setBins] = React.useState<Bin[]>([
    { id: 'bin-1', label: 'Monthly Materials', items: [] },
    { id: 'bin-2', label: 'Quarterly Materials', items: [] },
    { id: 'bin-3', label: 'Yearly Materials', items: [] },
    { id: 'bin-4', label: 'One-Time', items: [] },
  ]);

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

    // Create a prepared material in global state (as a Report)
    const now = new Date();
    const id = `prep-${now.getTime()}`;
    setDocuments(prev => [
      {
        id,
        name,
        type: '',
        size: '',
        uploadedBy: advisorName,
        uploadedAt: now,
        folder: 'Reports',
        requestFrequency: frequency,
      },
      ...prev,
    ]);

    toast({
      title: 'Material Added',
      description: `${name} added to Prepared Materials (${frequency}).`,
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
      <Card className="mb-6 border-green-200 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-100 to-green-50 border-b border-green-200">
          <CardTitle className="flex items-center gap-2 text-green-900">
            <FileText className="h-5 w-5" />
            Prepared Materials
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto inline-flex items-center gap-1 text-green-900">
                <span className="text-sm">{isOpen ? 'Hide' : 'Show'}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {bins.map((bin) => (
            <div
              key={bin.id}
              className={`rounded-lg p-3 min-h-[120px] border-2 border-dashed transition-colors bg-green-50/20 ${
                bin.isDragOver ? 'border-green-400 bg-green-50/60' : 'border-green-300'
              }`}
              onDragOver={(e) => { e.preventDefault(); toggleDragOver(bin.id, true); }}
              onDragLeave={() => toggleDragOver(bin.id, false)}
              onDrop={(e) => handleDrop(e, bin.id)}
            >
              <input
                value={bin.label}
                onChange={(e) => handleLabelChange(bin.id, e.target.value)}
                placeholder="Custom label"
                className="w-full mb-2 text-sm font-medium text-green-900 bg-transparent focus:outline-none"
              />
              <div className="space-y-2">
                {bin.items.length === 0 ? (
                  <p className="text-xs text-gray-500">Drag material types here</p>
                ) : (
                  bin.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 p-2 bg-white border border-green-100 rounded-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-gray-800 truncate">{item.name}</span>
                        <Badge className="text-xs bg-emerald-200 text-emerald-800">Prepared</Badge>
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
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Available material types</h4>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_MATERIAL_TYPES.map(type => (
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

export default PreparedMaterials;


