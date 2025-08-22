import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { PresetBin } from '@/types/dashboard';
import { useToast } from '@/hooks/use-toast';

type BinItem = { id: string; name: string; };

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

const Settings = () => {
  const { presets, savePreset, deletePreset, updatePreset } = useDocumentsStore();
  const { toast } = useToast();

  const [presetName, setPresetName] = React.useState('New Preset');
  const [bins, setBins] = React.useState<Array<{ id: string; label: string; items: BinItem[]; isDragOver?: boolean }>>([
    { id: 'bin-1', label: 'Monthly Docs', items: [] },
    { id: 'bin-2', label: 'Quarterly Docs', items: [] },
    { id: 'bin-3', label: 'Yearly Docs', items: [] },
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
  };

  const handleRemove = (binId: string, itemId: string) => {
    setBins(prev => prev.map(b => b.id === binId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b));
  };

  const handleLabelChange = (binId: string, value: string) => {
    setBins(prev => prev.map(b => b.id === binId ? { ...b, label: value } : b));
  };

  const handleSavePreset = () => {
    const presetBins: PresetBin[] = bins.map(b => ({ id: b.id, label: b.label, items: b.items.map(i => ({ name: i.name })) }));
    const created = savePreset(presetName, presetBins);
    toast({ title: 'Preset Saved', description: `Preset "${created.name}" created.` });
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Advisor Settings</h2>
      </div>

      <Card className="mb-6 border-blue-200 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-indigo-100 to-indigo-50 border-b border-blue-200">
          <CardTitle className="flex items-center gap-2 text-blue-900">
            Build Documents Needed Preset
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end mb-4">
            <div className="sm:w-64">
              <label className="block text-xs text-gray-600 mb-1">Preset name</label>
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="e.g., New Client Onboarding" />
            </div>
            <Button onClick={handleSavePreset} className="bg-blue-600 hover:bg-blue-700">Save Preset</Button>
          </div>

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
                          <Badge className="text-xs bg-indigo-200 text-indigo-800">Preset</Badge>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-500 hover:text-red-600" onClick={() => handleRemove(bin.id, item.id)}>
                          ×
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
      </Card>

      <Card className="border-blue-200 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-indigo-100 to-indigo-50 border-b border-blue-200">
          <CardTitle className="flex items-center gap-2 text-blue-900">
            Your Presets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-3">
          {presets.length === 0 && (
            <p className="text-sm text-gray-600">No presets yet. Create one above.</p>
          )}
          {presets.map(p => (
            <div key={p.id} className="p-3 border rounded-lg flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">{p.name}</div>
                <div className="text-xs text-gray-600">{p.bins.reduce((acc, b) => acc + b.items.length, 0)} documents • {p.bins.length} bins</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                  setPresetName(p.name);
                  setBins(p.bins.map(b => ({ id: b.id, label: b.label, items: b.items.map((i, idx) => ({ id: `${b.id}-${idx}-${Date.now()}`, name: i.name })) })));
                }}>Edit</Button>
                <Button variant="outline" size="sm" onClick={() => deletePreset(p.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;


