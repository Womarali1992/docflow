import React from 'react';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '@/components/docflow/icons';

type PresetBin = { id: string; label: string; items: { name: string }[] };

type BinItem = { id: string; name: string };

const DEFAULT_TYPES: string[] = [
  'Bank Statement', 'Tax Return', 'ID Copy', 'Pay Stub', 'Investment Statement',
  'Insurance Policy', 'W-2', '1099', 'Mortgage Statement', 'Business Financials',
  'K-1', 'Trust Agreement',
];

const Settings = () => {
  const { presets, savePreset, deletePreset } = useDocumentsStore();
  const { toast } = useToast();

  const [presetName, setPresetName] = React.useState('New Preset');
  const [bins, setBins] = React.useState<Array<{ id: string; label: string; items: BinItem[] }>>([
    { id: 'bin-1', label: 'Monthly',   items: [] },
    { id: 'bin-2', label: 'Quarterly', items: [] },
    { id: 'bin-3', label: 'Yearly',    items: [] },
    { id: 'bin-4', label: 'One-time',  items: [] },
  ]);
  const [overId, setOverId] = React.useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, name: string) => {
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDrop = (e: React.DragEvent, binId: string) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/plain');
    setOverId(null);
    if (!name) return;
    setBins(prev => prev.map(b => {
      if (b.id !== binId) return b;
      if (b.items.some(i => i.name.toLowerCase() === name.toLowerCase())) return b;
      return { ...b, items: [...b.items, { id: `${binId}-${Date.now()}`, name }] };
    }));
  };

  const handleRemove = (binId: string, itemId: string) =>
    setBins(prev => prev.map(b => b.id === binId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b));

  const handleLabelChange = (binId: string, value: string) =>
    setBins(prev => prev.map(b => b.id === binId ? { ...b, label: value } : b));

  const handleSavePreset = async () => {
    const presetBins: PresetBin[] = bins.map(b => ({
      id: b.id,
      label: b.label,
      items: b.items.map(i => ({ name: i.name })),
    }));
    try {
      const created = await savePreset(presetName, presetBins);
      toast({ title: 'Preset saved', description: `"${created.name}" created.` });
    } catch (err) {
      toast({ title: 'Save failed', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const totalItems = bins.reduce((s, b) => s + b.items.length, 0);

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Settings</h1>
          <div className="df-client-meta">
            <span>Document request presets</span>
            <span className="df-dot-sep" />
            <span>{presets.length} saved preset{presets.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Build a preset</div>
            <div className="df-section-sub">{totalItems} item{totalItems !== 1 ? 's' : ''} · drag types into a cadence</div>
          </div>
          <div className="df-right">
            <input
              className="df-input"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              style={{ width: 220 }}
            />
            <button className="df-btn df-sm df-primary" onClick={handleSavePreset}>
              <I.Check size={12} /> Save preset
            </button>
          </div>
        </div>
        <div className="df-section-body">
          <div className="df-bins">
            {bins.map(bin => (
              <div
                key={bin.id}
                className={'df-bin' + (overId === bin.id ? ' df-over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOverId(bin.id); }}
                onDragLeave={() => setOverId(null)}
                onDrop={(e) => handleDrop(e, bin.id)}
              >
                <div className="df-bin-head">
                  <input
                    value={bin.label}
                    onChange={(e) => handleLabelChange(bin.id, e.target.value)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--df-ink)',
                      outline: 0,
                      width: '70%',
                    }}
                  />
                  <span className="df-bin-cnt">{bin.items.length}</span>
                </div>
                {bin.items.length === 0 && <div className="df-bin-empty">Drop a type here</div>}
                {bin.items.map(it => (
                  <div key={it.id} className="df-bin-item">
                    <span className="df-dotc" />
                    <span>{it.name}</span>
                    <span className="df-x" onClick={() => handleRemove(bin.id, it.id)}><I.X size={11} /></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="df-types">
            {DEFAULT_TYPES.map(t => (
              <div key={t} className="df-type-chip" draggable onDragStart={(e) => handleDragStart(e, t)}>
                <span className="df-plus">+</span>{t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Saved presets</div>
            <div className="df-section-sub">{presets.length} preset{presets.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div className="df-list">
          {presets.length === 0 && <div className="df-empty">No presets yet. Build one above.</div>}
          {presets.map(p => {
            const total = p.bins.reduce((acc, b) => acc + b.items.length, 0);
            return (
              <div key={p.id} className="df-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
                <div>
                  <div className="df-name">{p.name}</div>
                  <div className="df-meta">{total} document{total !== 1 ? 's' : ''} · {p.bins.length} bin{p.bins.length !== 1 ? 's' : ''} · updated {p.updatedAt.toLocaleDateString()}</div>
                </div>
                <button
                  className="df-btn df-sm"
                  onClick={() => {
                    setPresetName(p.name);
                    setBins(p.bins.map(b => ({
                      id: b.id,
                      label: b.label,
                      items: b.items.map((i, idx) => ({ id: `${b.id}-${idx}-${Date.now()}`, name: i.name })),
                    })));
                  }}
                >
                  Edit
                </button>
                <button className="df-btn df-sm df-ghost" onClick={() => deletePreset(p.id)}>
                  <I.Trash size={12} /> Delete
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Settings;
